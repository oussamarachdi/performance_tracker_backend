const Signup = require('../models/Signup');
const MemberInfo = require('../models/MemberInfo');
const ExpaApplication = require('../models/ExpaApplication');

const normalizeString = (str) => (str || '').toString().trim().toLowerCase();

let cache = {
    data: null,
    timestamp: 0
};

const ALIAS_MAP = { 'med': 'mohamed' };

const levenshtein = (a, b) => {
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1)
                );
            }
        }
    }
    return matrix[b.length][a.length];
};

const resolveMemberName = (rawName, validKeys) => {
    let name = normalizeString(rawName);
    Object.keys(ALIAS_MAP).forEach(alias => {
        if (name.startsWith(alias + ' ')) {
            name = name.replace(alias + ' ', ALIAS_MAP[alias] + ' ');
        } else if (name.includes(' ' + alias + ' ')) {
            name = name.replace(' ' + alias + ' ', ' ' + ALIAS_MAP[alias] + ' ');
        }
    });

    if (validKeys.includes(name)) return name;

    let bestMatch = null;
    let minDistance = 3;

    for (let validName of validKeys) {
        let dist = levenshtein(name, validName);
        if (dist < minDistance) {
            minDistance = dist;
            bestMatch = validName;
        }
        if (validName.includes(name) && name.length > 6) {
            return validName;
        }
    }
    return bestMatch || name;
};

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const createBaseEntity = (id, name, extra = {}) => ({
    id,
    name,
    leads: 0,
    signups: 0,
    ...extra
});

const calculateConversion = (entity) => {
    if (entity.signups === 0) {
        entity.conversionRate = 0;
    } else {
        const rate = (entity.applied / entity.signups) * 100;
        entity.conversionRate = Math.round(rate * 100) / 100;
    }
};

const getAggregations = async () => {
    const now = Date.now();
    if (cache.data && (now - cache.timestamp < CACHE_TTL_MS)) {
        console.log('Serving dashboard data from cache');
        return cache.data;
    }

    console.log('Fetching fresh data from Google Sheets');
    // 1. Fetch raw data concurrently
    const [rawSignups, membersData, expaApps] = await Promise.all([
        Signup.getAll(),
        MemberInfo.getAll(),
        ExpaApplication.getAll()
    ]);

    // 2. Initialize Maps
    const membersMap = {};
    const departmentsMap = {};
    const universitiesMap = {};

    // Product map initialization based on standard types
    const productsMap = {
        'gta': createBaseEntity('gta', 'GTa', { description: 'Global Talent', applied: 0, dailyMetrics: [] }),
        'gte': createBaseEntity('gte', 'GTe', { description: 'Global Teacher', applied: 0, dailyMetrics: [] }),
        'gv': createBaseEntity('gv', 'GV', { description: 'Global Volunteer', applied: 0, dailyMetrics: [] })
    };

    const campaignMap = {}; // for storing daily metrics: date -> { signups, leads, contacted, interested, applied }

    // Globals
    const totals = {
        leads: 0,
        signups: 0,
        contacted: 0,
        interested: 0,
        applied: 0,
        alreadyExists: 0
    };

    // Pre-process Member Info into Maps to build relational scaffolding
    membersData.forEach(m => {
        const deptKey = normalizeString(m.Department);
        if (m.Department && !departmentsMap[deptKey]) {
            departmentsMap[deptKey] = createBaseEntity(deptKey, m.Department);
        }

        const nameKey = normalizeString(m.Name);
        if (m.Name && !membersMap[nameKey]) {
            membersMap[nameKey] = createBaseEntity(nameKey, m.Name, {
                department: m.Department,
                boothsAttended: 0,
                dailyMetrics: [],
                universitiesVisited: new Set(),
                productsPromoted: new Set(),
                universityBreakdown: {}, // uniKey -> signups
                productBreakdown: {}      // prodKey -> signups
            });
        }
    });

    // 3. Process Signups (Leads + Signups logic)
    // We will build a lookup for Email/Phone so we can trace Applications back to Products
    const signupLookupByEmail = {};
    const signupLookupByPhone = {};

    rawSignups.forEach(signup => {
        // --- A. Identify Fields ---
        // Robust member name key resolution
        const memberKeyStr = Object.keys(signup).find(k => k.toLowerCase().includes('member name'));
        const signupMemberName = memberKeyStr ? (signup[memberKeyStr] || '').trim() : '';

        const uniName = (signup['[UN] University Name'] || '').trim();
        const uniKey = normalizeString(uniName);

        const email = (signup['[E] Email'] || '').trim().toLowerCase();
        const phone = (signup['[PN] Phone Number'] || '').trim();
        const rawDate = (signup['Submitted at'] || '').trim();
        const dateOnly = rawDate ? rawDate.split(' ')[0] : 'Unknown';

        const firstColumnKey = Object.keys(signup)[0];
        const isLeadValid = signup[firstColumnKey] && signup[firstColumnKey].toString().trim() !== '';

        const status = (signup['Account Satus'] || '').trim().toLowerCase();
        const isCreated = status.includes('created successfully');
        const isExists = status.includes('already exists');

        const productStr = (signup['🌍 Type of abroad internship'] || '').trim().toLowerCase();
        let productKey = 'UNKNOWN';
        if (productStr.includes('professional')) productKey = 'gta';
        else if (productStr.includes('teaching')) productKey = 'gte';
        else if (productStr.includes('volunteering')) productKey = 'gv';

        // Save lookup
        if (email) signupLookupByEmail[email] = { productKey };
        if (phone) signupLookupByPhone[phone] = { productKey };

        // --- B. Increment Globals ---
        if (isLeadValid) totals.signups++;  // Swapped: Signups = Total rows
        if (isCreated) totals.leads++;      // Swapped: Leads = Created successfully
        if (isExists) totals.alreadyExists++;

        // --- C. Daily Campaign Metrics ---
        if (dateOnly !== 'Unknown') {
            if (!campaignMap[dateOnly]) {
                campaignMap[dateOnly] = { date: dateOnly, leads: 0, signups: 0, contacted: 0, interested: 0, applied: 0 };
            }
            if (isLeadValid) campaignMap[dateOnly].signups++; // Swapped
            if (isCreated) campaignMap[dateOnly].leads++;     // Swapped
        }

        // --- D. Product Metrics ---
        if (productsMap[productKey] && productKey !== 'UNKNOWN') {
            const pObj = productsMap[productKey];
            if (isLeadValid) pObj.signups++; // Swapped
            if (isCreated) pObj.leads++;     // Swapped

            if (dateOnly !== 'Unknown') {
                let dayMetric = pObj.dailyMetrics.find(d => d.date === dateOnly);
                if (!dayMetric) {
                    dayMetric = { date: dateOnly, signups: 0, leads: 0, applied: 0 };
                    pObj.dailyMetrics.push(dayMetric);
                }
                if (isLeadValid) dayMetric.signups++; // Swapped
                if (isCreated) dayMetric.leads++;     // Swapped
            }
        }

        // --- E. University Metrics ---
        if (uniName && uniKey !== 'unknown') {
            if (!universitiesMap[uniKey]) {
                universitiesMap[uniKey] = createBaseEntity(uniKey, uniName, { location: '', dailyMetrics: [] });
            }
            const uObj = universitiesMap[uniKey];
            if (isLeadValid) uObj.signups++; // Swapped
            if (isCreated) uObj.leads++;     // Swapped

            if (dateOnly !== 'Unknown') {
                let dayMetric = uObj.dailyMetrics.find(d => d.date === dateOnly);
                if (!dayMetric) {
                    dayMetric = { date: dateOnly, signups: 0, leads: 0, applied: 0 };
                    uObj.dailyMetrics.push(dayMetric);
                }
                if (isLeadValid) dayMetric.signups++; // Swapped
                if (isCreated) dayMetric.leads++;     // Swapped
            }
        }

        // --- F. Member & Department Metrics ---
        let rawMemberKey = normalizeString(signupMemberName);
        let memberKey = '';
        if (rawMemberKey) {
            memberKey = resolveMemberName(rawMemberKey, Object.keys(membersMap));
        }

        if (memberKey) {
            // Dynamic member creation if STILL completely unrecognized (keeps their leads valid)
            if (!membersMap[memberKey]) {
                membersMap[memberKey] = createBaseEntity(memberKey, signupMemberName || memberKey, {
                    department: 'Unknown',
                    boothsAttended: 0,
                    dailyMetrics: [],
                    universitiesVisited: new Set(),
                    productsPromoted: new Set(),
                    universityBreakdown: {},
                    productBreakdown: {}
                });
            }

            const mObj = membersMap[memberKey];
            if (isLeadValid) mObj.leads++;
            if (isCreated) {
                mObj.signups++;
                if (uniKey && uniKey !== 'unknown') {
                    mObj.universityBreakdown[uniKey] = (mObj.universityBreakdown[uniKey] || 0) + 1;
                }
                if (productKey !== 'UNKNOWN') {
                    mObj.productBreakdown[productKey] = (mObj.productBreakdown[productKey] || 0) + 1;
                }
            }
            if (uniKey && uniKey !== 'unknown') mObj.universitiesVisited.add(uniKey);
            if (productKey !== 'UNKNOWN') mObj.productsPromoted.add(productKey);

            // Personal Daily Metrics
            if (dateOnly !== 'Unknown') {
                let dayMetric = mObj.dailyMetrics.find(d => d.date === dateOnly);
                if (!dayMetric) {
                    dayMetric = { date: dateOnly, leads: 0, signups: 0, contacted: 0, interested: 0, applied: 0 };
                    mObj.dailyMetrics.push(dayMetric);
                }
                if (isLeadValid) dayMetric.leads++;
                if (isCreated) dayMetric.signups++;
            }

            // Department
            const deptKey = normalizeString(mObj.department);
            if (departmentsMap[deptKey]) {
                if (isLeadValid) departmentsMap[deptKey].leads++;
                if (isCreated) departmentsMap[deptKey].signups++;
            }
        }
    });

    // 4. Process Expa Applications for global AND Product 'applied' count
    const uniqueApps = new Set();
    expaApps.forEach(app => {
        const appId = (app['Person ID'] || '').trim();
        const email = (app['Email'] || '').trim().toLowerCase();
        const phone = (app['Phone'] || '').trim();

        if (appId && !uniqueApps.has(appId)) {
            uniqueApps.add(appId);
            totals.applied++;

            // --- USE ACTUAL APPLICATION DATE FOR GLOBAL VOLUME ---
            const appDateRaw = app['Created At'] || ''; // e.g. "2026-03-23T01:40:21Z"
            const appDate = appDateRaw.slice(0, 10);

            if (appDate && /^\d{4}-\d{2}-\d{2}$/.test(appDate)) {
                if (!campaignMap[appDate]) {
                    campaignMap[appDate] = { date: appDate, signups: 0, leads: 0, contacted: 0, interested: 0, applied: 0 };
                }
                campaignMap[appDate].applied++;
            }

            // Map application to Product (for attribution)
            let match = signupLookupByEmail[email];
            if (!match && phone) {
                match = signupLookupByPhone[phone];
            }

            if (match) {
                const signupDate = match.date;

                // A. Global Campaign Metrics (Already handled above for raw volume by appDate)
                // We DON'T increment campaignMap[signupDate].applied here to avoid double counting 
                // global volume, BUT we keep the attribution for members/prods/unis below using signupDate.

                // B. Product Daily Metrics
                if (match.productKey && productsMap[match.productKey]) {
                    const pObj = productsMap[match.productKey];
                    pObj.applied++; // Increment total
                    if (signupDate) {
                        let dayMetric = pObj.dailyMetrics.find(d => d.date === signupDate);
                        if (!dayMetric) {
                            dayMetric = { date: signupDate, leads: 0, signups: 0, applied: 0 };
                            pObj.dailyMetrics.push(dayMetric);
                        }
                        dayMetric.applied++;
                    }
                }

                // C. University Daily Metrics
                if (match.universityKey && universitiesMap[match.universityKey]) {
                    const uObj = universitiesMap[match.universityKey];
                    uObj.applied = (uObj.applied || 0) + 1;
                    if (signupDate) {
                        let dayMetric = uObj.dailyMetrics.find(d => d.date === signupDate);
                        if (!dayMetric) {
                            dayMetric = { date: signupDate, leads: 0, signups: 0, applied: 0 };
                            uObj.dailyMetrics.push(dayMetric);
                        }
                        dayMetric.applied++;
                    }
                }

                // D. Member Daily Metrics
                if (match.memberKey && membersMap[match.memberKey]) {
                    const mObj = membersMap[match.memberKey];
                    mObj.applied = (mObj.applied || 0) + 1;
                    if (signupDate) {
                        let dayMetric = mObj.dailyMetrics.find(d => d.date === signupDate);
                        if (!dayMetric) {
                            dayMetric = { date: signupDate, leads: 0, signups: 0, contacted: 0, interested: 0, applied: 0 };
                            mObj.dailyMetrics.push(dayMetric);
                        }
                        dayMetric.applied++;
                    }
                }
            }
        }
    });

    // 5. Finalize arrays and conversion rates
    const membersArray = Object.values(membersMap).map(m => {
        // Convert sets to arrays
        m.universitiesVisited = Array.from(m.universitiesVisited);
        m.productsPromoted = Array.from(m.productsPromoted);

        // Flatten breakdowns for the frontend
        m.universityBreakdown = Object.entries(m.universityBreakdown).map(([id, signups]) => {
            const uni = universitiesMap[id];
            return { id, name: uni ? uni.name : id, signups };
        }).sort((a, b) => b.signups - a.signups);

        m.productBreakdown = Object.entries(m.productBreakdown).map(([id, signups]) => {
            const prod = productsMap[id];
            return { id, name: prod ? prod.name : id, signups };
        }).sort((a, b) => b.signups - a.signups);

        m.dailyMetrics.sort((a, b) => new Date(a.date) - new Date(b.date));
        m.boothsAttended = m.dailyMetrics.length;

        return m;
    });

    const deptsArray = Object.values(departmentsMap);
    const unisArray = Object.values(universitiesMap).map(u => {
        u.dailyMetrics.sort((a, b) => new Date(a.date) - new Date(b.date));
        return u;
    });

    const prodsArray = Object.values(productsMap).map(p => {
        p.dailyMetrics.sort((a, b) => new Date(a.date) - new Date(b.date));
        return p;
    });
    prodsArray.forEach(calculateConversion);

    const campaignMetrics = Object.values(campaignMap).sort((a, b) => new Date(a.date) - new Date(b.date));

    let globalConversion = 0;
    if (totals.signups > 0) {
        globalConversion = Math.round((totals.applied / totals.signups) * 100 * 100) / 100;
    }

    const result = {
        members: membersArray,
        universities: unisArray,
        products: prodsArray,
        departments: deptsArray,
        campaignMetrics: campaignMetrics,
        totals: totals,
        conversionRate: globalConversion
    };

    // Update Cache
    cache.data = result;
    cache.timestamp = Date.now();

    return result;
};

module.exports = {
    getAggregations
};
