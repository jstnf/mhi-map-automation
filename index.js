const express = require('express');
const cron = require('node-cron');
const https = require('https');
const qs = require('querystring')
const utf8 = require('utf8')

const app = express();

// Set with environment variables (like on Heroku)
var apiKey = process.env.DATAWRAPPER_KEY;
const chartId = '3QuYf';

console.log('Using Datawrapper key: ' + apiKey);

// APPLICATION

// temp
var bodyData = '';

app.set('view engine', 'ejs');

// Run the routine once, and then schedule the cron job
routine();

// Run the cron job every day at 12am, 8am, and 4pm
cron.schedule('0 0 0,7,15 * * *', function() {
  routine();
})

const port = 8000;
app.listen(port, () => {
  console.log(`Example app listening on port ${port}!`);
});

app.get('/', (req, res) => {
  res.send('<p>' + bodyData + '</p>');
});

// ROUTINE

var _date = new Date();
var dateTimestamp = ''

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
    uploadData(trimmed);
  }).catch(() => {
    console.log('There was an error attempting to grab COVID data. Attempting to retry with yesterday\'s date!');
    _date.setDate(_date.getDate() - 1);
    dateTimestamp = getFormattedDate(_date);

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
      uploadData(trimmed);
    }).catch(() => {
      console.log('Could not grab yesterday\'s data. Abandoning job!')
    })
  });
}

// FUNCTIONS

var totalCases = 0;
var totalDeaths = 0;

// Sets totalCases and totalDeaths from the CSV data
function processData(responseBody) {
  totalCases = 0, totalDeaths = 0;

  const lines = responseBody.split('\n');
  lines.forEach(element => {
    const parts = element.split(',');
    // In our CSV, the cases and deaths are at columns 5 and 6 (starting from 0)
    if (isInt(parts[5]) && isInt(parts[6])) {
      totalCases += parseInt(parts[5]);
      totalDeaths += parseInt(parts[6]);
    }
  });

  console.log("Finished data totaling process:");
  console.log(" - cases: " + totalCases);
  console.log(" - deaths: " + totalDeaths);
}

function updateMetadata(responseBody) {
  const newDesc = '<b>Date:</b> ' + (new Intl.DateTimeFormat('en-US', { dateStyle: 'full' }).format(_date)) + '\n<br><b>Total Cases:</b> ' + totalCases + ' <b>Total Deaths:</b> ' + totalDeaths;

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
    'utf8': true,
    'metadata': {
      'describe': {
        'intro': `${newDesc}`
      },
      axes: {
        keys: 'Province_State',
        values: 'Incident_Rate'
      },
      "data": { // Extra column format might be breaking the table?
        "column-format": {
            "Active": [
            ],
            "Case_Fatality_Ratio": [
            ],
            "Confirmed": [
            ],
            "Country_Region": [
            ],
            "Deaths": [
            ],
            "FIPS": [
            ],
            "Hospitalization_Rate": [
            ],
            "ISO3": [
            ],
            "Last_Update": [
            ],
            "Lat": [
            ],
            "Long_": [
            ],
            "People_Hospitalized": [
            ],
            "Province_State": {
                "type": "text"
            },
            "Recovered": [
            ],
            "Testing_Rate": [
            ],
            "Total_Test_Results": [
            ],
            "UID": [
            ]
        },
        "horizontal-header": true,
        "transpose": false,
        "vertical-header": true
      },
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
    headers: {
      'authorization': `Bearer ${apiKey}`
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
          updateMetadata(responseBody);
        }
    });

  }).on('error', e => {
    console.log('ERROR!')
    console.log(e);
  });

  // Update with gathered data
  dataPutReq.write(JSON.stringify(responseBody));
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
        console.log('Body: ', JSON.parse(data));

        // Successfully updated the data, let's publish
        if (publishPostRes.statusCode === 200) {
          console.log('Successfully published new chart!')
        }
    });

  }).on('error', e => {
    console.log('ERROR!')
    console.log(e);
  });

  publishPostReq.end();
}

function getFormattedDate(d) {
  var formatted = ''
  formatted = (d.getMonth() + 1).toString().padStart(2, '0') + '-' + d.getDate().toString().padStart(2, '0') + '-' + d.getFullYear();
  return formatted;
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

function isInt(str) {
  if (typeof str != "string") return false // we only process strings!  
  return !isNaN(str) && // use type coercion to parse the _entirety_ of the string (`parseFloat` alone does not do this)...
         !isNaN(parseInt(str)) // ...and ensure strings of whitespace fail
}