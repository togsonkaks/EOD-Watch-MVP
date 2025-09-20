# EOD Watch - End of Day Stock Watchlist

## Overview
A minimal stock watchlist application that displays end-of-day candlestick charts with EMA indicators. The application uses the Tiingo API to fetch stock data and displays it using Lightweight Charts.

## Project Structure
- `server.js` - Express.js backend server that proxies Tiingo API requests
- `public/index.html` - Frontend single-page application with stock chart visualization
- `package.json` - Node.js dependencies and scripts
- `.env` - Environment variables (contains TIINGO_TOKEN)

## Features
- Real-time stock data visualization with candlestick charts
- 200-period EMA overlay
- Clean dark theme interface
- Symbol search functionality
- Health check endpoint

## Technical Details
- **Backend**: Express.js server running on port 5000
- **Frontend**: Vanilla JavaScript with Lightweight Charts v4.1.3
- **API**: Tiingo financial data API
- **Environment**: Node.js 20 on Replit

## Configuration
- Server binds to `0.0.0.0:5000` for Replit environment compatibility
- Uses `TIINGO_TOKEN` environment variable for API authentication
- Deployment configured for VM target to maintain persistent connection

## Recent Changes (2025-09-20)
- Configured server to run on port 5000 and bind to all interfaces for Replit
- Fixed Lightweight Charts compatibility by pinning to version 4.1.3
- Set up workflow for automatic server startup
- Configured deployment settings for production use
- Environment variables properly configured for Replit environment

## User Preferences
- Project successfully imported from GitHub and configured for Replit environment
- All existing project structure and dependencies maintained