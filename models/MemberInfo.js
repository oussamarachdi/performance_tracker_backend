const { getRows } = require('../services/googleSheetsService');

class MemberInfo {
    static formatData(rows) {
        if (!rows || rows.length === 0) return [];

        // There is no standard header row, so we map directly from indexes
        return rows.map(row => {
            return {
                Name: (row[0] || '').trim(),
                Department: (row[1] || '').trim()
            };
        }).filter(m => m.Name); // Filter out any completely empty rows
    }

    static async getAll() {
        // Assuming the sheet is named "Members Info"
        const rows = await getRows(`'Members Info'!A:Z`);
        return this.formatData(rows);
    }
}

module.exports = MemberInfo;
