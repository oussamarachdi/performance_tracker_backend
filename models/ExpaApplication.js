const { getRows } = require('../services/googleSheetsService');

class ExpaApplication {
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
        // Assuming the sheet is named "Expa Application" 
        const rows = await getRows(`'Expa Application'!A:Z`);
        if (!rows || rows.length === 0) return [];
        return this.formatData(rows);
    }
}

module.exports = ExpaApplication;
