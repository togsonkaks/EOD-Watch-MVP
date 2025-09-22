# EOD Watch MVP - Setup Guide

## Environment Configuration

### Required Environment Variables

The application requires a Tiingo API token to function properly:

1. Create a `.env` file in the root directory
2. Add your Tiingo API token:
   ```
   TIINGO_TOKEN=your_tiingo_api_token_here
   ```

### Getting a Tiingo API Token

1. Sign up for a free account at [tiingo.com](https://www.tiingo.com/)
2. Navigate to your account settings
3. Generate an API token
4. Copy the token to your `.env` file

## Running the Application

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the server:
   ```bash
   npm start
   ```

3. Open your browser to `http://localhost:5000`

## Troubleshooting

### Chart Not Loading

If the main chart is not loading, check the following:

1. **Missing API Token**: Ensure `TIINGO_TOKEN` is set in your `.env` file
   - Error message: "❌ Missing TIINGO_TOKEN in .env"
   - Solution: Create `.env` file with valid Tiingo API token

2. **Server Not Starting**: Check console for error messages
   - The server will exit with code 1 if required environment variables are missing

3. **API Rate Limits**: Free Tiingo accounts have rate limits
   - The application uses intelligent caching to minimize API calls
   - Cache files are stored in the `cache/` directory

## Development

- Server runs on port 5000 by default
- Frontend files are served from the `public/` directory
- Chart implementation uses LightweightCharts library
- Data is fetched via `/eod` endpoint with caching layer
