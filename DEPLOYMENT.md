# Deployment Options for EOD Watch

## For Demo (FREE - Use This Now)

**Current dev URL**: Your Replit dev URL is FREE and works right now
- Share this URL with stakeholders for demo
- Backend is running (live data from Tiingo API)
- Drawing tools work
- No cost while testing

**Limitation**: Goes offline when you close the Repl tab

---

## For Permanent FREE Static Hosting (After Demo)

1. **Stop the Server workflow** (so backend doesn't run)
2. **In Replit UI**: Click "Publish" → Choose "Static Deployment"
3. **Configure**: Set public directory to `public`
4. **Deploy**: Click Publish (FREE hosting with 100GB bandwidth/month)

The app will automatically use embedded sample data when backend is unavailable.

---

## After Stakeholder Approval (Switch to Backend)

1. **In Replit UI**: Delete static deployment
2. **Re-deploy as "Reserved VM"** (paid ~$20/month)
3. Backend server.js will run and provide live market data
4. All drawing tools work with real Tiingo API data

---

## Technical Notes

- `server.js` is preserved and ready to use
- Embedded sample data provides 252 days of realistic AAPL stock data
- Fallback logic in `fetchBars()` automatically uses embedded data when backend unavailable
- Drawing tools coordinate conversion uses fallback system for reliability
