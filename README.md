# newrelic-browser-synthetics-generator

## Usage

Add all of the account(s) you want to automate the creation of monitors and alerts for in the `accounts` array.

```
accounts.push({ id: 'ACCOUNT_RPM_ID', name: 'ACCOUNT_NAME', apiKey: 'ADMIN_API_KEY', insightsApiKey: 'INSIGHTS_QUERY_KEY'})
```

Run the script

```
npm start
```