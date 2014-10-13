// server.js

// BASE SETUP
// =============================================================================

// call the packages we need
var express     = require('express'); 		// call express
var app         = express(); 				// define our app using express
var bodyParser  = require('body-parser');
var csv         = require('fast-csv');

// Our models
var Calibration = require('./app/models/calibration');

// configure app to use bodyParser()
// this will let us get the data from a POST
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

var port = process.env.PORT || 8081; 		// set our port

// ROUTES FOR OUR API
// =============================================================================
var router = express.Router(); 				// get an instance of the express Router

var sendResponsePayload = function(payload, res, format) {
  if(format === 'csv') {
    var output = csv.createWriteStream({headers:true});
    res.set({'Content-Type': 'text/csv'});
    // Include content-type header
    output.pipe(res);
    if(Array.isArray(payload)) {
      payload.forEach(function(element) { output.write(element); });
    } else {
      output.write(payload);
    }
    output.end();
  } else {
    res.json(payload);
  }
};

// Routes for our API will happen here
router.route('/calibrations/:calibration_id')
  .get(function(req, res) {
    Calibration.findById(req.params.calibration_id, function(err, calibration) {
      if (err) {
        res.send(err);
      } else {
        sendResponsePayload(calibration, res, req.query.hasOwnProperty('format') ? req.query.format : null);
      }
    });
  });

router.route('/calibrations')
  .get(function(req, res) {
    if(req.query.hasOwnProperty('filter')) {
      Calibration.findByFilter(req.query, function(err, calibrations) {
        if (err) {
          res.send(err);
        } else {
          sendResponsePayload(calibrations, res, req.query.hasOwnProperty('format') ? req.query.format : null);
        }
      });
    } else if(req.query.hasOwnProperty('clade')) {
      Calibration.findByClade(req.query, function(err, calibrations) {
        if (err) {
          res.send(err);
        } else {
          sendResponsePayload(calibrations, res, req.query.hasOwnProperty('format') ? req.query.format : null);
        }
      });
    } else {
      res.send({'error':'Please use a filter or calibration id'});
    }
  });

// REGISTER OUR ROUTES -------------------------------
// all of our routes will be prefixed with /api
app.use('/api', router);

// START THE SERVER
// =============================================================================
app.listen(port);
console.log('Server listening on port ' + port);