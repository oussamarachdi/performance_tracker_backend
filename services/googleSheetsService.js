const { google } = require('googleapis');
require('dotenv').config();

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly'];

// Helper to initialize auth safely
let auth;
try {
    const credentialsJson = process.env.GOOGLE_SERVICE_ACCOUNT || process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || './mkt-tracker.json';

    if (credentialsJson) {
        console.log('Using Google Service Account from environment variable.');
        auth = new google.auth.GoogleAuth({
            credentials: JSON.parse(credentialsJson),
            scopes: SCOPES,
        });
    } else {
        console.log(`Using Google Service Account from file: ${credentialsPath}`);
        auth = new google.auth.GoogleAuth({
            keyFile: credentialsPath,
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
