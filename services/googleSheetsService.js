const { google } = require('googleapis');
require('dotenv').config();

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly'];

// Using the credentials path from .env or defaulting to root
const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || './mkt-tracker.json';

const auth = new google.auth.GoogleAuth({
    keyFile: credentialsPath,
    scopes: SCOPES,
});

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
