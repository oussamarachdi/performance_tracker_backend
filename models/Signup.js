const { getRows } = require('../services/googleSheetsService');

class Signup {
    static formatData(rows) {
        if (!rows || rows.length === 0) return [];

        const headers = rows[0];
        return rows.slice(1).map(row => {
            let obj = {};
            headers.forEach((header, index) => {
                obj[header] = row[index] || '';
            });
            return obj;
        });
    }

    static async getAll() {
        // We assume the sheet is named "Signups"
        // Fetching columns A to Z to ensure all columns are retrieved
        const rows = await getRows('Signups!A:Z');
        return this.formatData(rows);
    }
}

module.exports = Signup;
