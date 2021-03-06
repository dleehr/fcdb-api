var config = require('../../config/config');
var mysql  = require('mysql');
var pool  = mysql.createPool(config);
var async = require('async');

/*
  Creates a Fossil object from a database row
 */

function Fossil(databaseRow) {
  // From Link_CalibrationFossil and View_Fossils
  this.id = databaseRow['FossilID'];
  this.collection = databaseRow['CollectionAcro'];
  this.collectionNumber = databaseRow['CollectionNumber'];
  this.shortReference = databaseRow['ShortName'];
  this.fullReference = databaseRow['FullReference'];
  this.stratUnit = databaseRow['Stratum'];
  this.maxAge = databaseRow['MaxAge'];
  this.maxAgeType = databaseRow['MaxAgeType'];
  this.maxAgeTypeDetails = databaseRow['MaxAgeTypeOtherDetails'];
  this.minAge = databaseRow['MinAge'];
  this.minAgeType = databaseRow['MinAgeType'];
  this.minAgeTypeDetails = databaseRow['MinAgeTypeOtherDetails'];
  this.locationRelativeToNode= databaseRow['FossilLocationRelativeToNode'];
}

/*
 Creates an Image object from a database row
 */
function Image(databaseRow) {
  var PUBLICATION_IMAGE_ROOT = 'https://fossilcalibrations.org/publication_image.php?id=';
  this.id = databaseRow['PublicationID'];
  this.url = PUBLICATION_IMAGE_ROOT + databaseRow['PublicationID'];
  this.caption = databaseRow['caption'];
}

/*
  Creates a calibration object from a database row
 */
function Calibration(databaseRow) {
  if(!databaseRow) {
    return;
  }
  // Properties to fill
  this.id = databaseRow['CalibrationID'];
  this.nodeName = databaseRow['NodeName'];
  this.nodeMinAge = databaseRow['MinAge'];
  this.nodeMaxAge = databaseRow['MaxAge'];
  this.calibrationReference = databaseRow['FullReference'];
  this.fossils = [];
  this.publicationImages = [];
  this.treeImages = [];
}

function Calibrations() {
  var TABLE_NAME = 'View_Calibrations';
  // this callback is err, rows, fields
  function query(queryString, queryParams, callback) {
    return pool.query(queryString, queryParams, callback);
  }

  // Fetches a calibration and populates its fossils
  function getCalibration(calibrationId, callback, failWhenNotFound) {
    failWhenNotFound = failWhenNotFound || false;
    fetchCalibration(calibrationId, function(err, calibration) {
      if(err) {
        callback(err);
      } else if(calibration == null) {
        // not found
        if(failWhenNotFound) {
          callback({error: 'calibration with id: ' + calibrationId + ' not found'});
        } else {
          // call back with null.
          callback(null, calibration);
        }
      } else {
        // Switch to async to chain these instead of the growing callback pyramid
        // attach fossils
        fetchFossils(calibrationId, function (err, fossils) {
          if (err) {
            callback(err);
          } else {
            calibration.fossils = fossils;
            fetchPublicationImages(calibrationId, function (err, publicationImages) {
              if(err) {
                callback(err);
              } else {
                calibration.publicationImages = publicationImages;
                fetchTreeImages(calibrationId, function (err, treeImages) {
                  if(err) {
                    callback(err);
                  } else {
                    calibration.treeImages = treeImages;
                    // Calibration is complete
                    callback(null, calibration);
                  }
                });
              }
            });
          }
        });
      }
    });
  }

  // Fetch a single calibration from the database by ID and produce a single object
  function fetchCalibration(calibrationId, callback) {
    var STATUS_PUBLISHED = 4;
    // When fetching a calibration, exclude non-published calibrations
    var queryString = 'SELECT * FROM ' + TABLE_NAME + ' WHERE CalibrationID = ? ' +
      'AND CalibrationID in (SELECT CalibrationID FROM calibrations WHERE PublicationStatus = ?) LIMIT 1';
    query(queryString, [calibrationId, STATUS_PUBLISHED], function(err, results) {
      if(err) {
        callback(err);
      } else if(results.length == 0) {
        callback(null, null);
      } else {
        var calibrationResult = new Calibration(results[0]);
        callback(null, calibrationResult);
      }
    });
  }

  // Fetch Fossils for a calibration from the database and produce a list of fossils
  function fetchFossils(calibrationId, callback) {
    var queryString = 'SELECT F.*, L.* from Link_CalibrationFossil L, View_Fossils F WHERE L.CalibrationId = ? AND L.FossilID = F.FossilID';
    query(queryString, [calibrationId], function(err, results) {
      if(err) {
        callback(err);
      } else {
        var fossilResults = results.map(function(result) { return new Fossil(result); });
        callback(null, fossilResults);
      }
    });
  }

  // Fetch Publication images for a calibration from the database and produce a list of publication images
  function fetchPublicationImages(calibrationId, callback) {
    var queryString = 'SELECT P.* from View_Calibrations C, publication_images P WHERE C.CalibrationID = ? AND C.PublicationID = P.PublicationID';
    query(queryString, [calibrationId], function(err, results) {
      if(err) {
        callback(err);
      } else {
        var publicationImages = results.map(function(result) { return new Image(result); });
        callback(null, publicationImages);
      }
    });
  }

  // Tree images are stored in the publication_image table, but use -1 * CalibrationID instead of a PublicationID
  // We use the same data structure to return the images.
  function fetchTreeImages(calibrationId, callback) {
    var treeImageId = -1 * calibrationId;
    var queryString = 'SELECT P.* from publication_images P where P.PublicationID = ?';
    query(queryString, [treeImageId], function(err, results) {
      if(err) {
        callback(err);
      } else {
        var treeImages = results.map(function(result) { return new Image(result); });
        callback(null, treeImages);
      }
    });
  }

  this.findById = function(calibrationId, callback) {
    getCalibration(calibrationId, function(err, calibration) {
      if (err) {
        callback(err);
      } else {
        callback(null, calibration);
      }
    }, true);
  };

  function intersection_destructive(a, b)
  {
    var result = new Array();
    while( a.length > 0 && b.length > 0 )
    {
      if      (a[0] < b[0] ){ a.shift(); }
      else if (a[0] > b[0] ){ b.shift(); }
      else /* they're equal */
      {
        result.push(a.shift());
        b.shift();
      }
    }

    return result;
  }

  /*
    Calibrations can be searched by taxon/clade or age/geological period
   */
  this.query = function(params, callback) {
    // avoid closure conflicts
    var thisCalibration = this;

    // Convenience functions for ultimate success/failure
    var success = function(results) {
      // wrap the results and params
      var responseObject = {query: params, calibrations: results};
      callback(null, responseObject);
    };

    var failed = function(err) {
      callback(err);
    };

    /*
     * The individual search methods will return IDs of calibration
     * objects in the database. These will be tracked in an array and intersected
     * as subsequent filters are added.
     * Initially this is null, to indicate uninitialized, rather than an empty array,
     * which would never intersect with anything.
     */
    var filteredCalibrationIds = null;

    /*
     Merge (destructively) onto the filteredCalibrationIds array
     first time this is called (when filteredCalibrationIds is null) it will
     replace the array. On subsequent calls, it will intersect it
     */
    var mergeCalibrationIds = function(calibrationIds) {
      // If first call, replace the array
      // This is different than an empty array!
      if(filteredCalibrationIds === null) {
        filteredCalibrationIds = calibrationIds;
      } else {
        filteredCalibrationIds = intersection_destructive(filteredCalibrationIds, calibrationIds);
      }
    };

     // convenience/refactored. Handles callback logic around merging
    var handleCalibrationIds = function(handleErr, calibrationIds, callback) {
      if(handleErr) {
        failed(handleErr);
      } else {
        mergeCalibrationIds(calibrationIds);
        callback();
      }
    };

    /*
     * Should be the last step in the chain. After all filters are applied, we'll
     * have an array of calibration IDs. turn these into full objects and call success.
     */
    var populateCalibrations = function() {
      var uniqueIds = filteredCalibrationIds.filter(function (value, index, array) {
        return array.indexOf(value) === index;
      });

      // uniqueIds is an array of calibration IDs
      thisCalibration.populateCalibrations(uniqueIds, function(err, calibrations) {
        if(err) {
          failed(err);
        } else {
          // filter out null values - they indicate no calibration was found for the ID
          calibrations = calibrations.filter(function(result) { return result !== null; });
          success(calibrations);
        }
      });
    };

    /*
     * Individual filters
     * 1. Age (min/max or geological time)
     * 2. Tree (clade or tipTaxa)
     * These will actually happen in reverse order, because callbacks have to be
     * written in reverse order
     */

    // 1. Age Search
    var ageSearchDone = function() {
      // age search is the last one, populate the calibrations and finish.
      populateCalibrations();
    };

    var handleAgeResults = function(ageErr, calibrationIds) {
      handleCalibrationIds(ageErr, calibrationIds, ageSearchDone);
    };

    // parse age search parameters. If no parameters (default case) we're done
    var doAgeSearch = function() {
      ageSearchDone();
    };

    // 'geologicalTime' and 'minAge/maxAge' are mutually exclusive
    if(params.hasOwnProperty('geologicalTime')) {
      doAgeSearch = function() {
        thisCalibration.findByGeologicalTime(params.geologicalTime, handleAgeResults)
      }
    } else if(params.hasOwnProperty('minAge') || params.hasOwnProperty('maxAge')) {
      doAgeSearch = function() {
        thisCalibration.findByMinMax(params.minAge, params.maxAge, handleAgeResults)
      }
    }

    // 2. Tree search
    var treeSearchDone = function() {
      // after tree search, do age search
      doAgeSearch();
    };

    var handleTreeResults = function(treeErr, calibrationIds) {
      handleCalibrationIds(treeErr, calibrationIds, treeSearchDone);
    };

    // parse tree search parameters. If no parameters (default case), we're done
    var doTreeSearch = function() {
      treeSearchDone(null);
    };

    // 'clade' and 'taxonA/taxonB' are mutually exclusive
    if(params.hasOwnProperty('clade')) {
      doTreeSearch = function() {
        thisCalibration.findByClade(params.clade, handleTreeResults);
      };
    } else if(params.hasOwnProperty('tipTaxa')) {
      doTreeSearch = function() {
        thisCalibration.findByTipTaxa(params.tipTaxa, handleTreeResults);
      };
    }

    // All callbacks in place, start!
    doTreeSearch();
  };

  // Call the database to populate all the calibrations in the array of ids
  this.populateCalibrations = function(calibrationIds, callback) {
    // MySQL results are always provided in callbacks. async.map executes a transform
    // function on each item in the array, and calls callback when done.
    async.map(calibrationIds, getCalibration, callback);
  };

  /* Age Search implementation */

  // Gets the calibration IDs in the range and passes along to the callback
  this.findByMinMax = function(minAge, maxAge, callback) {
    var success = function(result) {
      callback(null, result);
    };

    var failed = function(err) {
      callback(err);
    };

    // Must provide either minAge, maxAge, or both.
    var baseQueryString = 'SELECT CalibrationID FROM ' + TABLE_NAME + ' WHERE ';
    var clause = [];
    var params = [];
    if(minAge != null) {
      clause.push('(MinAge >= ? OR MinAge = 0) AND (MaxAge >= ? OR maxAge = 0)');
      params.push(minAge);
      params.push(minAge);
    }
    if(maxAge != null) {
      clause.push('(MinAge <= ? OR MinAge = 0) AND (MaxAge <= ? OR maxAge = 0)');
      params.push(maxAge);
      params.push(maxAge);
    }

    if(clause.length === 0) {
      failed({error:'Cannot find by age unless minAge or maxAge is specified'});
      return;
    }

    // Now join the clauses
    var joinedClause = clause.join(' AND ');
    var queryString = baseQueryString + joinedClause;

    // Get the calibrationIDs and call the callback with them
    query(queryString, params, function(err, results) {
      if(err) {
        failed(err);
        return;
      }
      var calibrationIDs = results.map(function(result) { return result['CalibrationID']; });
      success(calibrationIDs);
    });
  };

  // Gets the calibration IDs corresponding to the comma-separated geological time name
  // (e.g. Neogene,Miocene,Burdigalian), and passes along to the callback
  this.findByGeologicalTime = function(geologicalTime, callback) {
    var success = function(result) {
      callback(null, result);
    };

    var failed = function(err) {
      callback(err);
    };

    // Via https://github.com/NESCent/FossilCalibrations/blob/b29a0fa6cdfb4c822f60013bde8ace3677a20514/fetch-search-results.php#L418
    // This query causes the filter to be interpreted very loosely:
    // For example, 'geologicalTime=C' will be treated as C%, matching everything in Cretaceous, Carboniferous, Cambrian
    // The parameters should be matched against the times first
    var queryString = 'SELECT CalibrationID FROM Link_CalibrationFossil WHERE FossilID IN ' +
      '(SELECT FossilID FROM fossils WHERE LocalityID IN ' +
      '(SELECT LocalityID FROM localities WHERE GeolTime IN ' +
      '(SELECT GeolTimeID FROM geoltime WHERE CONCAT_WS(\',\', Period,Epoch,Age) LIKE CONCAT(?, \'%\'))))';
    var params = [];
    // This should be an array
    if(geologicalTime != null && geologicalTime.length > 0) {
      // Should be of the format "Period, Epoch, Age"
      // Period must be provided, Epoch and Age are optional
      params.push(geologicalTime);
    }

    if(params.length === 0) {
      failed({error:'Cannot find by Geological Time unless a time period is specified'});
      return;
    }

    // Get the calibrationIDs and call the callback with them
    query(queryString, params, function(err, results) {
      if(err) {
        failed(err);
        return;
      }
      var calibrationIDs = results.map(function(result) { return result['CalibrationID']; });
      success(calibrationIDs);
    });
  };

  /* Tree search implementation */
  // Calls callback with something like {'source':'NCBI', 'taxonid': 4}:
  function fetchNCBITaxonId(ncbiTaxonName, callback) {
    var queryString = 'SELECT taxonid, \'NCBI\' AS source FROM NCBI_names WHERE '
      + 'name LIKE ? OR uniquename LIKE ? LIMIT 1';
    query(queryString, [ncbiTaxonName, ncbiTaxonName], function(err, results) {
      if (err) {
        callback(err);
      } else {
        callback(null, results.length > 0 ? results[0] : null);
      }
    });
    // php code will fall back to FCD names
  }

  function fetchMultiTreeNodeId(taxon, callback) {
    var queryString = 'SELECT getMultiTreeNodeID(?,?) AS node_id';
    query(queryString, [taxon.source, taxon.taxonid], function (err, results) {
      if (err) {
        callback(err);
      } else {
        // Results resemble this:
        // getMultiTreeNodeID('FCD-116',241); -> [{'node_id' : -1}]
        callback(null, results.length > 0 ? results[0].node_id : null);
      }
    });
  }

  // multiTreeNodeIDs is an array of node ids
  function fetchMultiTreeNodeForMRCA(multitreeNodeIds, callback) {
    // Based on getMultitreeIDForMRCA() in
    // https://github.com/NESCent/FossilCalibrations/blob/b29a0fa6cdfb4c822f60013bde8ace3677a20514/FCD-helpers.php#L155
    var queryString = 'CALL getMostRecentCommonAncestor(?,?, \'temp_MRCA\', \'ALL TREES\'); SELECT * FROM temp_MRCA';
    query(queryString , multitreeNodeIds, function(err, results) {
      // Since queryString has two statements, results will be an array with two objects
      if(err) {
        callback(err);
      } else {
        // results[1] is an array, looks like [{"node_id":33392,"parent_node_id":33340,"depth":-12}] (or [] if empty!)
        callback(null, results[1].length > 0 ? results[1][0] : null);
      }
    });
  }

  function fetchMultiTreeAncestors(multiTreeNodeId, callback) {
    var queryString = 'CALL getAllAncestors(?,\'temp_ancestors\',\'ALL TREES\'); SELECT * from temp_ancestors';
    query(queryString, [multiTreeNodeId], function(err, results) {
      // since queryString has two statements, results will be an array with two objects
      if(err) {
        callback(err);
      } else {
        // results[1] is an array
        callback(null, results[1].length > 0 ? results[1] : null);
      }
    });
  }

  function fetchCalibrationIdsInCladeMultiTree(multiTreeNodeId, callback) {
    var queryString = 'SELECT DISTINCT calibration_id FROM calibrations_by_NCBI_clade WHERE clade_root_multitree_id = ?';
    query(queryString, [multiTreeNodeId], function(err, results) {
      if (err) {
        callback(err);
      } else {
        var extractedIds = results.map(function(result) { return result['calibration_id']; });
        callback(null, extractedIds);
      }
    });
  }

  function fetchCalibrationIdsFromTrees(nodeIds, callback) {
    // adapted from addAssociatedCalibrations()
    // via https://github.com/NESCent/FossilCalibrations/blob/b29a0fa6cdfb4c822f60013bde8ace3677a20514/FCD-helpers.php#L313
    var queryString = 'SELECT * FROM FCD_trees WHERE tree_id IN (SELECT tree_id FROM FCD_nodes WHERE node_id IN (?))';
    query(queryString, [nodeIds], function(err, results) {
      if(err) {
        callback(err);
      } else {
        var extractedIds = results.map(function(result) { return result['calibration_id']; });
        callback(null, extractedIds);
      }
    });
  }

  function fetchSourceNodeIdsFromMultiTree(multiTreeNodeIds, callback) {
    // adapted from addAssociatedCalibrations()
    // via https://github.com/NESCent/FossilCalibrations/blob/b29a0fa6cdfb4c822f60013bde8ace3677a20514/FCD-helpers.php#L293
    var queryString = 'SELECT * FROM node_identity WHERE source_tree != \'NCBI\' AND is_pinned_node = 0 AND multitree_node_id IN (?)';
    query(queryString, [multiTreeNodeIds], function(err, results) {
      if(err) {
        callback(err);
      } else {
        var sourceNodeIds = results.map(function (result) {
          return result['source_node_id']
        });
        callback(null, sourceNodeIds);
      }
    });
  }

  // Callback is (err, calibrationIds)
  this.findByClade = function(taxonName, callback) {
    // Starts with a clade/taxon name
    fetchNCBITaxonId(taxonName, function(err, taxon) {
      // have a taxon id, now get the multi tree from the taxon
      if (err) {
        callback(err);
        return;
      }
      if(!taxon) {
        callback({error:'No node found for ' + taxonName});
        return;
      }
      fetchMultiTreeNodeId(taxon, function(err, multiTreeNodeId) {
        if (err) {
          callback(err);
          return;
        }
        // have a multi tree, now see what calibrations are in it.
        fetchCalibrationIdsInCladeMultiTree(multiTreeNodeId, function(err, calibrationIds) {
          callback(err, calibrationIds);
        });
      });
    });
  };

  Array.prototype.nullIndexes = function() {
    var nulls = [];
    this.forEach(function(value, index) {
      if(value === null) {
        nulls.push(index);
      }
    });
    return nulls;
  };
  // Callback is (err, calibrationIds)
  this.findByTipTaxa = function(tipTaxa, callback) {
    // tipTaxa is an array of taxon names
    var success = function(result) {
      callback(null, result);
    };

    var failed = function(err) {
      callback(err);
    };
    if(tipTaxa.length == 0 || tipTaxa.length > 2) {
      failed({error: 'Must provide 1 or 2 tip taxa'});
      return;
    }
    // 1. Find the taxon ids for each taxon
    async.map(tipTaxa, fetchNCBITaxonId, function(err, taxa) {
      var nulls = taxa.nullIndexes();
      if(nulls.length > 0) {
        var badTaxa = nulls.map(function(index) { return tipTaxa[index]; });
        failed({error:'Unable to find taxa for: ' + badTaxa.join(', ')});
        return;
      }
      // Find the node id in the multi tree
      async.map(taxa, fetchMultiTreeNodeId, function (err, nodeIds) {
        var nulls = nodeIds.nullIndexes();
        if(nulls.length > 0) {
          var badTaxa = nulls.map(function(index) { return tipTaxa[index]; });
          failed({error:'Unable to find node ids for: ' + badTaxa.join(', ')});
          return;
        }
        // If there are two taxa, we need to get their MRCA node and fetch ancestors of all 3 nodes
        // If only one taxon, only fetch the ancestors of that node
        var fetchAncestors = function(multiTreeNodeIds) {
          async.map(multiTreeNodeIds, fetchMultiTreeAncestors, function(err, ancestors) {
            // ancestors will be 3 arrays of { node_id: 33208, parent_node_id: 33154, depth: -15 },
            // This flattens the array
            async.map(ancestors, function(ancestorNodes, callback) {
              var nodeIds = ancestorNodes.map(function(node) { return node.node_id; });
              fetchSourceNodeIdsFromMultiTree(nodeIds, function(err, sourceNodeIds) {
                fetchCalibrationIdsFromTrees(sourceNodeIds, callback);
              });
            }, function(err, calibrationIds) {
              if(err) {
                failed(err);
              } else {
                // calibrationIds will be an array of 3 arrays,
                // e.g.[ [1,2,3], [4,5,6], [7,8] ]
                // flatten the array to [1,2,3,4,5,6,7,8]
                var merged = [].concat.apply([], calibrationIds);
                success(merged);
              }
            });
          });
        };
        // if there is only one tip taxon, just fetchMultiTreeAncestors
        if(taxa.length == 1) {
          fetchAncestors(nodeIds)
        } else {
          // if there are two node ids, get the multi tree for the mrca
          fetchMultiTreeNodeForMRCA(nodeIds, function(err, mrcaNode) {
            // Fetch ancestors of nodes for taxonA, taxonB, and mrca - collect their nodes
            var nodeIdsToFetch = nodeIds.slice(0); // copy the array
            nodeIdsToFetch.push(mrcaNode.node_id);
            fetchAncestors(nodeIdsToFetch);
          });
        }
      });
    });
  }
}

module.exports = new Calibrations();