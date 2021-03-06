const express = require('express');
const cron = require('node-cron');
const https = require('https');
const qs = require('querystring')
const utf8 = require('utf8')

const app = express();

/* ENVIRONMENT VARIABLES */
var apiKey = process.env.DATAWRAPPER_KEY;
const chartId = process.env.DATAWRAPPER_CHART_ID;

// Listen to process.env.PORT (Heroku) or 5000 and host '0.0.0.0'
const PORT = process.env.PORT || 5000;
const HOST = '0.0.0.0';

console.log('Using Datawrapper key: ' + apiKey);

/* APPLICATION VARIABLES */
var mapCurrentVersion = 0;                    // Current map version (used when displaying the iframe of the map)
var _date = new Date();                       // Global variable used in routine() and update functions
var dateTimestamp = '';                       // Global variable used in routine() function
var formattedData = '';                       // Global variable used in routine() function
var totalCases = 0;                           // Used when processing data - inserted into description of map
var totalDeaths = 0;                          // Used when processing data - inserted into description of map
var headersAdded = false;                     // Used when processing data - whether we have added the headers to the CSV data

/* APPLICATION SETUP */
app.set('view engine', 'ejs');

/**
 * We will run the map gathering routine once when the app starts.
 * Afterwards, we schedule the cron job. The job occurs
 * every 12am, 8am, and 4pm server time.
 */
routine();
cron.schedule('0 0 0,7,15 * * *', function() {
  routine();
})

app.listen(PORT, HOST, () => {
  console.log(`Example app listening on port ${PORT}!`);
});

app.get('/', (req, res) => {
  res.send(`
  
  <iframe title="COVID-19 Cases Per 100,000 People in United States" aria-label="map" id="datawrapper-chart-${chartId}" src="https://datawrapper.dwcdn.net/${chartId}/${mapCurrentVersion}/" scrolling="no" frameborder="0" style="width: 0; min-width: 100% !important; border: none;" height=10%></iframe><script type="text/javascript">!function(){"use strict";window.addEventListener("message",(function(a){if(void 0!==a.data["datawrapper-height"])for(var e in a.data["datawrapper-height"]){var t=document.getElementById("datawrapper-chart-"+e)||document.querySelector("iframe[src*='"+e+"']");t&&(t.style.height=a.data["datawrapper-height"][e]+"px")}}))}();
				</script>
  
  `);
});

/* ROUTINE FUNCTION */
function routine() {
  console.log('Performing cron update routine for MHI map!');

  // Reset the date
  _date = new Date();
  dateTimestamp = getFormattedDate(_date)
  console.log('Detected date ' + dateTimestamp + '. Attempting to grab data from JH COVID github!');

  getReport().then((data) => {
    const response = {
      statusCode: 200,
      body: data,
    };
    console.log('Successfully obtained data from ' + dateTimestamp + '!');

    // We end up with an extra comma sometimes, let's get rid of that!
    var trimmed = response.body.trim();
      if (trimmed.charAt(trimmed.length - 1) === ',') {
        console.log("Removing extraneous comma!");
        trimmed = trimmed.substring(0, trimmed.length - 1);
      }

    // We successfully grabbed the data, let's continue
    processData(trimmed);
    uploadData(formattedData);
  }).catch(() => {
    console.log('There was an error attempting to grab COVID data. Attempting to retry with yesterday\'s date!');
    var yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    dateTimestamp = getFormattedDate(yesterday);

    getReport().then((data) => {
      const response = {
        statusCode: 200,
        body: data,
      };
      console.log('Successfully obtained data from ' + dateTimestamp + '!');
  
      // We end up with an extra comma sometimes, let's get rid of that!
      var trimmed = response.body.trim();
      if (trimmed.charAt(trimmed.length - 1) === ',') {
        console.log("Removing extraneous comma!");
        trimmed = trimmed.substring(0, trimmed.length - 1);
      }

      console.log(trimmed);

      // We successfully grabbed the data, let's continue
      processData(trimmed);
      uploadData(formattedData);
    }).catch(() => {
      console.log('Could not grab yesterday\'s data. Last attempt to retry with data from two days ago!');
      var twoDaysAgo = new Date();
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
      dateTimestamp = getFormattedDate(twoDaysAgo);

      getReport().then((data) => {
        const response = {
          statusCode: 200,
          body: data,
        };
        
        console.log('Successfully obtained data from ' + dateTimestamp + '!');
    
        // We end up with an extra comma sometimes, let's get rid of that!
        var trimmed = response.body.trim();
        if (trimmed.charAt(trimmed.length - 1) === ',') {
          console.log("Removing extraneous comma!");
          trimmed = trimmed.substring(0, trimmed.length - 1);
        }

        console.log(trimmed);

        // We successfully grabbed the data, let's continue
        processData(trimmed);
        uploadData(formattedData);
      }).catch(() => {
        console.log('Could not grab data from today, yesterday, or two days ago. Abandoning job!');
      });
    });
  });
}

/* FUNCTIONS */
// Sets totalCases and totalDeaths from the CSV data
function processData(responseBody) {
  totalCases = 0, totalDeaths = 0;

  // Reset variables for next run
  formattedData = '';
  headersAdded = false;

  const lines = responseBody.split('\n');
  lines.forEach(element => {
    const parts = element.split(',');
    // In our CSV, the cases and deaths are at columns 5 and 6 (starting from 0)
    if (isInt(parts[5]) && isInt(parts[6])) {
      totalCases += parseInt(parts[5]);
      totalDeaths += parseInt(parts[6]);
    }
    
    if (headersAdded) {
      // Skip certain rows
      if (parts[0] === 'American Samoa' 
          || parts[0] === 'Diamond Princess'
          || parts[0] === 'Grand Princess'
          || parts[0] === 'Northern Mariana Islands') {
        return;
      }
      formattedData += parts[0] + ',' + parts[10] + ',' + parts[5] + ',' + parts[6] + '\u000a';
    } else {
      formattedData += 'state,rate,confirmed,deaths\u000a';
      headersAdded = true;
    }
  });

  console.log("Finished data totaling process:");
  console.log(" - cases: " + totalCases);
  console.log(" - deaths: " + totalDeaths);

  console.log('Updating data with new format...');
  console.log('Updated format below:');
  console.log(formattedData);
}

function updateMetadata() {
  const ye = new Intl.DateTimeFormat('en', { year: 'numeric' }).format(_date);
  const mo = new Intl.DateTimeFormat('en', { month: 'long' }).format(_date);
  const da = new Intl.DateTimeFormat('en', { day: 'numeric' }).format(_date);
  const dateString = `${mo} ${da}, ${ye}`;

  const newDesc = '<b>Date:</b> ' + dateString + '\n<br><b>Total Cases:</b> ' + numberWithCommas(totalCases) + ' <b>Total Deaths:</b> ' + numberWithCommas(totalDeaths);

  const descPatchReq = https.request({
    host: 'api.datawrapper.de',
    path: '/v3/charts/' + chartId,
    method: 'PATCH',
    headers: {
      'authorization': `Bearer ${apiKey}`
    }
  }, descPatchRes => {

    let data = '';

    console.log('Status: ', descPatchRes.statusCode);
    console.log('Headers: ', JSON.stringify(descPatchRes.headers));

    descPatchRes.setEncoding('utf8');

    descPatchRes.on('data', chunk => {
      data += chunk;
    });

    descPatchRes.on('end', () => {
      console.log('Body: ', JSON.parse(data));

      // Successfully updated the chart, let's add data and then publish
      if (descPatchRes.statusCode === 200) {
        console.log('Successfully updated chart metadata!');
        console.log('Proceeding to publish chart!');
        publishChart();
      }
    });

  }).on('error', e => {
    console.log('ERROR!')
    console.log(e);
  });

  // Update with current date and time, COVID total stats
  let params = JSON.stringify({
    "title": "COVID-19 Cases Per 100,000 People in United States",
    'metadata': {
      'describe': {
        "byline": "Masked Heroes Initiative",
        'intro': `${newDesc}`,
        "source-name": "Johns Hopkins University",
        "source-url": "https://github.com/CSSEGISandData/COVID-19"
      },
      axes: {
        keys: 'state',
        values: 'rate',
      },
      "data": {
        "column-format": {
          "state": {
            "type": "text"
          }
        }
      },
      "visualize": {
        "tooltip": {
          "body": "<b>Cases per 100,000:</b> {{ rate }}\n<br><b>Total:</b> {{ confirmed }}\n<br><b>Deaths:</b> {{ deaths }}",
          "enabled": true,
          "sticky": true,
          "title": "{{ state }}"
        }
      },
      "zoom-button-pos": "br",
      "zoomable": true
    }
  });
  console.log(params);
  descPatchReq.write(params);
  descPatchReq.end();
}

function uploadData(responseBody) {
  const dataPutReq = https.request({
    host: 'api.datawrapper.de',
    path: '/v3/charts/' + chartId + "/data",
    method: 'PUT',
    encoding: 'utf8',
    headers: {
      'authorization': `Bearer ${apiKey}`,
      'Content-Type': 'text/csv;charset=utf-8',
      'Accept': '*/*'
    }
  }, dataPutRes => {

    let data = '';

    console.log('Status: ', dataPutRes.statusCode);
    console.log('Headers: ', JSON.stringify(dataPutRes.headers));

    dataPutRes.setEncoding('utf8');

    dataPutRes.on('data', chunk => {
      data += chunk;
    });

    dataPutRes.on('end', () => {
      console.log('Body: ', data);

      // Successfully updated the data, let's publish
      if (dataPutRes.statusCode === 204) {
        console.log('Successfully updated chart data!');
        console.log('Proceeding to update chart metadata!');
        updateMetadata();
      }
    });

  }).on('error', e => {
    console.log('ERROR!')
    console.log(e);
  });

  // Update with gathered data
  dataPutReq.write(responseBody);
  dataPutReq.end();
}

function publishChart() {
  console.log('Attempting chart publish.')
  const publishPostReq = https.request({
    host: 'api.datawrapper.de',
    path: '/v3/charts/' + chartId + "/publish",
    method: 'POST',
    headers: {
      'authorization': `Bearer ${apiKey}`
    }
  }, publishPostRes => {

    let data = '';

    console.log('Status: ', publishPostRes.statusCode);
    console.log('Headers: ', JSON.stringify(publishPostRes.headers));

    publishPostRes.setEncoding('utf8');

    publishPostRes.on('data', chunk => {
        data += chunk;
    });

    publishPostRes.on('end', () => {
        var parsedData = JSON.parse(data);
        console.log('Body: ', parsedData);

        if (publishPostRes.statusCode === 200) {
          // Update the current version
          mapCurrentVersion = parsedData.version;
          console.log('Successfully published new chart! (version ' + mapCurrentVersion + ')');
        }
    });

  }).on('error', e => {
    console.log('ERROR!')
    console.log(e);
  });

  publishPostReq.end();
}

function getReport() {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: 'raw.githubusercontent.com',
      path: '/CSSEGISandData/COVID-19/master/csse_covid_19_data/csse_covid_19_daily_reports_us/' + dateTimestamp + '.csv',
      method: 'GET'
    }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error('statusCode=' + res.statusCode));
      }
      var body = '';
      res.setEncoding('utf8');
      res.on('data', function(chunk) {
        body += chunk;
      });
      res.on('end', function() {
        resolve(body);
      });
    });
    req.on('error', (e) => {
      reject(e.message);
    });
    // send the request
    req.end();
  });
}

/* UTILITY FUNCTIONS */
function isInt(str) {
  if (typeof str != "string") return false          // we only process strings!  
  return !isNaN(str) &&                             // use type coercion to parse the _entirety_ of the string (`parseFloat` alone does not do this)...
         !isNaN(parseInt(str))                      // ...and ensure strings of whitespace fail
}

function getFormattedDate(d) {
  var formatted = ''
  formatted = (d.getMonth() + 1).toString().padStart(2, '0') + '-' + d.getDate().toString().padStart(2, '0') + '-' + d.getFullYear();
  return formatted;
}

// https://stackoverflow.com/questions/2901102/how-to-print-a-number-with-commas-as-thousands-separators-in-javascript
function numberWithCommas(x) {
  return x.toString().replace(/\B(?<!\.\d*)(?=(\d{3})+(?!\d))/g, ",");
}