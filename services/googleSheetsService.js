const { google } = require('googleapis');
require('dotenv').config();

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly'];

// Helper to initialize auth safely
let auth;
try {
    // Collect potential credential sources
    const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT;
    const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    const credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

    // Check if any of these look like the actual JSON content
    let finalCredentials = null;
    let source = '';

    const potentialJson = [serviceAccountJson, credsJson, credsPath].find(val => val && (val.includes('{') || val.includes('service_account')));

    if (potentialJson) {
        // Strip out any accidental prefix if the user pasted "VAR_NAME=JSON"
        const cleanJson = potentialJson.includes('=') && potentialJson.indexOf('{') > potentialJson.indexOf('=')
            ? potentialJson.substring(potentialJson.indexOf('{'))
            : potentialJson;

        finalCredentials = JSON.parse(cleanJson);

        // Ensure private_key has actual newlines (not literal \n strings)
        if (finalCredentials.private_key) {
            finalCredentials.private_key = finalCredentials.private_key.replace(/\\n/g, '\n');
        }

        source = 'environment variable';
    }

    if (finalCredentials) {
        console.log(`Using Google Service Account from ${source}.`);
        auth = new google.auth.GoogleAuth({
            credentials: finalCredentials,
            scopes: SCOPES,
        });
    } else {
        const path = credsPath || './mkt-tracker.json';
        console.log(`Using Google Service Account from file: ${path}`);
        auth = new google.auth.GoogleAuth({
            keyFile: path,
            scopes: SCOPES,
        });
    }
} catch (err) {
    console.error('CRITICAL: Failed to initialize Google Auth:', err.message);
    // We don't throw here to allow the module to load, but subsequent calls will fail with this error
    auth = {
        getClient: () => { throw new Error(`Google Auth not initialized: ${err.message}`); }
    };
}

const getSheetsClient = async () => {
    const client = await auth.getClient();
    return google.sheets({ version: 'v4', auth: client });
};

/**
 * Fetches rows from a given range in the Google Sheet.
 * @param {string} range - e.g., 'Signups!A:Z'
 * @returns {Array} - Array of rows
 */
const getRows = async (range) => {
    try {
        const sheets = await getSheetsClient();
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
            range: range,
        });
        return response.data.values;
    } catch (error) {
        console.error(`Error fetching range ${range}:`, error.message);
        throw error;
    }
};

module.exports = {
    getRows,
};
