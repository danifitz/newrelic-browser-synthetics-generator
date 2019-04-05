const request = require('request')
const crypto = require('crypto')
const fs = require('fs')

const euAccount = false;

// Used to store all the app metadata for comparison. When the scripts runs, it should check if all the browser apps
// still exist i.e. hasn't been decomissioned and that the page URLs are still the most popular. If not, clean up
// the old monitors, alert policy conditions and create new ones for the most popular pages.
let appStore = {
    table: []
}

// Page weight Alert Policy name
const alertPolicyName = 'Page Weight'

let accounts = []
accounts.push({ id: '', name: '', apiKey: '', insightsApiKey: ''})

// How many of your top pages do you want monitors for?
const howManyPages = 5

// Let's go!
createMonitorsAndAlerts()

/*
 * For each Browser application in an account, fetch the
 * top 5 pages by number of Page Views. Create a 
 * Simple Browser Synthetics monitor and corresponding
 * Alert Condition under a single Alert Policy for each
 * of the pages.
 * 
 * Keeps a reference to exactly what was created so that
 * we can run this periodically and make sure Browser
 * apps haven't been decomissioned and that we are
 * always running against popular pages
 */
async function createMonitorsAndAlerts() {
    if(euAccount) console.log('Targeting EU API')

    // surround in a try/catch block - is this good enough error handling?
    try {
        // load the list of what we created last time
        const existingPages = await readJSONFileFromDisk('browserApps.json')

        // loop through the list of accounts
        for(let outerLoopCounter = 0; outerLoopCounter < accounts.length; outerLoopCounter++) {
            // Store the record of what is created in this variable
            let accountRecord = {}
            accountRecord.name = accounts[outerLoopCounter].name

            // Create an empty array to store a list of the browser apps in the account record
            accountRecord.browserApps = []

            // Check if a Page Weight Alert Policy exists in the account
            let policyExists = await alertPolicyExists(accounts[outerLoopCounter].apiKey, alertPolicyName)
            console.log(policyExists)
            
            // If the policy doesn't exist, create it
            let policyId = 0
            if(!policyExists) {
                let policyResult = await createAlertPolicy(accounts[outerLoopCounter].apiKey, alertPolicyName)
                policyId = policyResult.policy.id
            // If the policy exists
            } else {
                // get the alert policy id
                let policyResult = await getAlertPolicy(accounts[outerLoopCounter].apiKey, alertPolicyName)
                policyId = policyResult.policies[0].id
            }

            // store the policy ID created in the record of the account
            accountRecord.policyId = policyId

            // get all the browser apps for this account
            let apps = await getBrowserApplications(accounts[outerLoopCounter])
            console.log(`Found ${apps.browser_applications.length} Browser apps`)

            // loop through the list of browser apps in this account
            for(let innerLoopCounter = 0; innerLoopCounter < apps.browser_applications.length; innerLoopCounter++) {
                // we don't want to store the large loader_script so let's delete that attribute that is returned by the API
                delete apps.browser_applications[innerLoopCounter].loader_script
                // record the browser app
                accountRecord.browserApps.push(apps.browser_applications[innerLoopCounter])
                
                // Check if we've dealt with this account before
                if(existingPages.table.filter(existingPage => existingPage.name === accounts[outerLoopCounter].name)) {
                    console.log(`matched ${accounts[outerLoopCounter].name} to a record for ${existingPage.name} in browserApps.json`)                    
                }

                // get a list of the top 5 pages by views
                let top5Result = await getTop5BrowserPages(accounts[outerLoopCounter], apps.browser_applications[innerLoopCounter]);
                let top5 = top5Result.facets

                // record the top 5 pages for the browser app
                // need to hash each page URL for a unique reference to that page for later comparison
                accountRecord.browserApps[innerLoopCounter].top5 = []

                // create Simple Browser synthetic checks for the top 5 pages
                for(let pageLoopCounter = 0; pageLoopCounter < top5.length; pageLoopCounter++) {
                    // create the monitor
                    let monitorId = await createSyntheticMonitor(accounts[outerLoopCounter].apiKey, top5[pageLoopCounter].name)
                    // create the alert condition for the monitor in the Page Weight alert policy
                    let syntheticsCondition = await createAlertPolicyCondition(accounts[outerLoopCounter].apiKey, policyId, top5[pageLoopCounter].name, monitorId)
                    // get the alert policy condition id that we just created
                    let alertPolicyConditionId = syntheticsCondition.synthetics_condition.id

                    // Store the monitor ID, Alert condition policy ID and a unique hash reference to the page URL for later comparison
                    let pageRef = {
                        url: top5[pageLoopCounter].name,
                        hash: getHashString(top5[pageLoopCounter].name),
                        monitorId: monitorId,
                        alertPolicyConditionId: alertPolicyConditionId
                    }
                    // add the page ref to the account record
                    accountRecord.browserApps[innerLoopCounter].top5.push(pageRef)
                }
            }
            // Add the account record to the appStore
            appStore.table.push(accountRecord)
        }
        // Write the account record to a file on disk (for now)
        writeJSONFileToDisk(JSON.stringify(appStore))
    } catch(error) {
        // Oh No!
        console.log('There was an error', error);
    }
}

function getBrowserApplications(account) {
    console.log(`Getting a list of all browser apps in account ${account.name}`)
    const options = {
        url: `https://api.${isEUAccount()}newrelic.com/v2/browser_applications.json`,
        json: true,
        headers: {
            'X-Api-Key': account.apiKey
        }
    }
    return new Promise(resolve => {
        request(options, (error, response, body) => {
            if (error) throw(error)
            resolve(body)
        })
    })
}

// Given a Browser app, get the top 5 most visited pages by PageView using the Insights API
function getTop5BrowserPages(account, browserApp) {
    console.log(`Getting top 5 pages for ${browserApp.name}`)
    const nrqlQuery = encodeURIComponent(`FROM PageView SELECT count(pageUrl) WHERE appId = ${browserApp.id} FACET pageUrl SINCE 1 day ago LIMIT ${howManyPages}`);
    const options = {
        url: `https://insights-api.${isEUAccount()}newrelic.com/v1/accounts/${account.id}/query?nrql=${nrqlQuery}`,
        json: true,
        headers: {
            'X-Query-Key': account.insightsApiKey
        }
    }
    return new Promise(resolve => {
        request(options, (error, response, body) => {
            if (error) throw(error)
            resolve(body)
        })
    })
}

// Create a synthetic monitor - returns the monitor ID
function createSyntheticMonitor(apiKey, pageUrl) {
    console.log(`Creating Synthetic monitor for ${pageUrl}`)
    let monitorConfig = {
        name: `SIMPLE BROWSER - ${pageUrl}`,
        type: 'BROWSER',
        frequency: 15, // must be one of 1, 5, 10, 15, 30, 60, 360, 720, or 1440
        uri: pageUrl,
        // Locations: https://docs.newrelic.com/docs/synthetics/new-relic-synthetics/administration/synthetics-public-minion-ips#locations-labels
        locations: ['AWS_EU_WEST_2'],
        status: 'ENABLED', // ENABLED, MUTED, DISABLED
        slaThreshold: 1.0
        // see available options: https://docs.newrelic.com/docs/apis/synthetics-rest-api/monitor-examples/manage-synthetics-monitors-rest-api#create-monitor
    }
    return new Promise(resolve => {
        const options = {
            url: `https://synthetics.${isEUAccount()}newrelic.com/synthetics/api/v3/monitors`,
            method: 'POST',
            json: true,
            headers: {
                'X-Api-Key': apiKey
            },
            body: monitorConfig
        }
        request(options, (error, response, body) => {
            if (error) throw(error)

            // Get the monitor ID from the headers which New Relic returns
            const monitorLocation = response.headers['location']
            const monitorId = monitorLocation.substring(monitorLocation.lastIndexOf('/') + 1, monitorLocation.length)
            resolve(monitorId)
        })
    })
}

// Create a new relic alert policy
// https://docs.newrelic.com/docs/alerts/rest-api-alerts/new-relic-alerts-rest-api/rest-api-calls-new-relic-alerts#policies-list
function createAlertPolicy(apiKey, name) {
    console.log(`Creating alert policy ${name}`)
    const alertPolicy = {
        policy: {
            incident_preference: 'PER_POLICY',
            name: name
        }
    }
    return new Promise(resolve => {
        const options = {
            url: `https://api.${isEUAccount()}newrelic.com/v2/alerts_policies.json`,
            method: 'POST',
            json: true,
            headers: {
                'X-Api-Key': apiKey
            },
            body: alertPolicy
        }
        request(options, (error, response, body) => {
            if (error) throw(error)
            resolve(body)
        })
    })
}

function getAlertPolicy(apiKey, name) {
    console.log(`Looking for the UID of Alert Policy - ${name}`)
    return new Promise(resolve => {
        const options = {
            url: `https://api.${isEUAccount()}newrelic.com/v2/alerts_policies.json?filter[name]=${encodeURIComponent(name)}`,
            method: 'GET',
            json: true,
            headers: {
                'X-Api-Key': apiKey
            }
        }
        request(options, (error, response, body) => {
            if (error) throw(error)
            resolve(body)
        })
    })
}

function createAlertPolicyCondition(apiKey, policyId, monitorName, monitorId) {
    console.log(`Creating condition for Synthetic monitor ${monitorName} for Alert Policy with ID: ${policyId}`)
    // 64 character limit on condition names
    // TODO If we have to shorten the name, what makes sense?
    if(monitorName.length > 64) monitorName = monitorName.substring(0, 63);
    const syntheticCondition = {
        synthetics_condition: {
            name: monitorName,
            monitor_id: monitorId,
            runbook_url: '',
            enabled: true
        }
    }
    return new Promise(resolve => {
        const options = {
            url: `https://api.${isEUAccount()}newrelic.com/v2/alerts_synthetics_conditions/policies/${policyId}.json`,
            method: 'POST',
            json: true,
            headers: {
                'X-Api-Key': apiKey
            },  
            body: syntheticCondition
        }
        request(options, (error, response, body) => {
            if (error) reject(error)
            resolve(body)
        })
    })
}

// Check if an alert policy exists
function alertPolicyExists(apiKey, policyName) {
    console.log(`Checking if alert policy ${policyName} exists`)
    return new Promise(resolve => {
        const options = {
            url: `https://api.${isEUAccount()}newrelic.com/v2/alerts_policies.json?filter[name]=${encodeURIComponent(policyName)}`,
            method: 'GET',
            json: true,
            headers: {
                'X-Api-Key': apiKey
            }
        }
        request(options, (error, response, body) => {
            if (error) throw(error)
            const result = body
            if (result.policies.length > 0) {
                console.log(`Alert policy ${policyName} does exist`)
                resolve(true)
            } else {
                console.log(`Alert policy ${policyName} does not exist - creating...`)
                resolve(false)
            }
        })
    })
}

// Returns a base64 encoded SHA256 hash digest for a given string
function getHashString(string) {
    const hash = crypto.createHash('sha256');
    hash.update(string);
    return hash.digest('base64');
}

function writeJSONFileToDisk(json) {
    fs.writeFile('browserApps.json', json, 'utf8', function() {
        console.log('Wrote JSON file to disk')
    });
}

function readJSONFileFromDisk(path) {
    return new Promise(resolve => {
        fs.readFile(path, 'utf8', (jsonString, err) => {
            if (err) throw err
            resolve(JSON.parse(jsonString))
        })
    })
}
// If EU account, return string fragment to make URLs point to EU region API
function isEUAccount() {
    return (euAccount ? 'eu.' : '')
}