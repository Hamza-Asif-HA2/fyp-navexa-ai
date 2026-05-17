const axios = require('axios');
require('dotenv').config();

// Get a valid token from environment or test user
const testToken = process.env.TEST_SPOTIFY_TOKEN || 'test-token';

const testSearch = async () => {
    try {
        console.log('[TEST] Starting Spotify search test...');
        console.log('[TEST] Base URL: https://api.spotify.com/v1');
        
        // Test 1: Without offset
        const encoded_q = encodeURIComponent('Hum');
        const queryString = `q=${encoded_q}&type=track&limit=20`;
        const fullUrl = `https://api.spotify.com/v1/search?${queryString}`;
        
        console.log('[TEST] Testing URL:', fullUrl);
        console.log('[TEST] Would send Authorization header');
        
        // We can't actually test without a valid token, but we can show what would be sent
        console.log('[TEST] Request would include:');
        console.log('  - URL:', fullUrl);
        console.log('  - Method: GET');
        console.log('  - Headers: { Authorization: Bearer <token> }');
        console.log('  - Timeout: 10000ms');
        
        console.log('\n[TEST] Expected Spotify response format:');
        console.log('  { tracks: { items: [...], total: X, limit: 20, offset: 0 } }');
        
    } catch (error) {
        console.error('[TEST] Error:', error.message);
    }
};

testSearch();
