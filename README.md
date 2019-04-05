# Synthetics & Alerts generator
A script to automatically generate Synthetics checks and corresponding Alert conditions for all
Browser apps in a New Relic account.

### What is Synthetics?
New Relic Synthetics is a suite of automated, scriptable tools to monitor your websites, critical business transactions, and API endpoints.

### What are Alert conditions?
In New Relic Alerts, an alert condition describes a monitored data source and the behavior of that data source that will be considered a violation.

This script will query the top X pages for each app monitored by New Relic Browser and create Synthetic monitors that will emulate a real browser
visiting the page and give you a detailed breakdown of how the page loads including all the assets on that page such as JS, CSS etc. Alert conditions
will notify you if the page fails to load.

## Usage

Add all of the account(s) you want to automate the creation of monitors and alerts for in the `accounts` array.

```
accounts.push({ id: 'ACCOUNT_RPM_ID', name: 'ACCOUNT_NAME', apiKey: 'ADMIN_API_KEY', insightsApiKey: 'INSIGHTS_QUERY_KEY'})
```

Run the script

```
npm start
```