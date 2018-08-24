const express = require('express');
const router = express.Router();
const spawn = require('child_process').spawn;
const net = require('net');
const HOST = '127.0.0.1';
const PORT = 3001;
const pyClient = {};
const pyServer = {};
const isConnectionEstablished = {}; // key -> session_id; value: socket.id
const isDataLoaded = {};
const dataLoaded = {};
const serverOnTime = {};
// var session = require('express-session');
const callback_store = {};
const startTimeStore = {};
let chunks = [];
const got = require('got');
const pyServerURL = 'http://127.0.0.1:3002';


module.exports = function(io) {

    //SOCKET.IO
    router.get('/', function(req, res) {
        var sessId = req.session.id;
        console.log("session id is : "+sessId);
        session_id = sessId;
        res.end("ok");
    });

    io.on('connection',function(socket){

        //initialize the socket connection with the python script. this is executed when user initializes a pygdfCrossfilter instance
        socket.on('init', function(dataset, callback){
            try{
                console.log("connection init requested");
                socket.session_id = parseCookie(socket.handshake.headers.cookie);
                if(isConnectionEstablished[socket.session_id+dataset] === true){
                    callback(false,'connection already established');
                }else{
                    initConnection(socket.session_id,dataset,function(error,result){
                        callback(error, result);
                    });
                }
            }catch(ex){
                console.log(ex);
                clearGPUMem();
            }
        });

        //loads the data in GPU memory
        socket.on('load_data', function(dataset, callback){
            try{
                console.log("user tried to load data from "+dataset);
                // resetServerTime(dataset,socket.session_id);

                if(isDataLoaded[socket.session_id+dataset] && dataLoaded[socket.session_id+dataset] === dataset && isConnectionEstablished[socket.session_id+dataset]){
                      console.log('data already loaded');

                      let command = 'reset_all_filters';
                      let query = {
                          'session_id': socket.session_id,
                          'dataset': dataset
                      };

                      pygdf_query(command,params(query),'reset_all',callback);
                }else{

                      console.log("loading new data in gpu mem");
                      let command = 'read_data';
                      let query = {
                          'session_id': socket.session_id,
                          'dataset': dataset
                      };
                      console.log("params",params(query));

                      pygdf_query(command,params(query),'read_data',(error, message) => {
                          if(!error){
                            isDataLoaded[socket.session_id+dataset] = true
                            dataLoaded[socket.session_id+dataset] = dataset
                            callback(false,message);
                          }else{
                            console.log(error);
                            callback(error,false);
                          }
                      });
                    }
            }catch(ex){
                console.log(ex);
                clearGPUMem();
            }
        });

        socket.on("resetAllFilters", function(dataset,callback){
            let command = 'reset_all_filters';
            let query = {
                'session_id': socket.session_id,
                'dataset': dataset
            };

            pygdf_query(command,params(query),'reset_all',callback);
        });

        //get schema of the dataset
        socket.on('getSchema', function(dataset,callback){
            try{
                let command = 'get_schema';
                let query = {
                    'session_id': socket.session_id,
                    'dataset': dataset
                };

                pygdf_query(command,params(query),"user requesting schema of the dataset",callback);

            }catch(ex){
                console.log(ex);
                callback(true,-1);
                clearGPUMem();
            }

        });

        //load dimension
        socket.on('dimension_load', function(column_name,dataset, callback){
            try{
                let command = 'dimension_load';
                let query = {
                    'session_id': socket.session_id,
                    'dataset': dataset,
                    'dimension_name': column_name
                };

                pygdf_query(command,params(query),"user requesting loading a new dimension:"+column_name,callback);

            }catch(ex){
                console.log(ex);
                callback(true,-1);
                clearGPUMem();
            }
        });

        //query the dataframe -> return results
        socket.on('dimension_filter', function(column_name,dataset,comparison,value,callback){
            try{
                let command = 'dimension_filter';
                let query = {
                    'session_id': socket.session_id,
                    'dataset': dataset,
                    'dimension_name': column_name,
                    'comparison_operation':comparison,
                    'value': value
                };

                pygdf_query(command,params(query),"user requesting filtering of the dataset",(error, message) => {
                    if(!error){
                      socket.emit("update_size", dataset, JSON.parse(message)['data']);
                      callback(false,message);
                    }else{
                      console.log(error);
                      callback(error,false);
                    }
                });

            }catch(ex){
                console.log(ex);
                callback(true,-1);
                clearGPUMem();
            }
        });

        //query the dataframe -> return results
        socket.on('groupby_load', function(column_name,dataset,agg,callback){
            try{
                let command = 'groupby_load';
                let query = {
                    'session_id': socket.session_id,
                    'dataset': dataset,
                    'dimension_name': column_name,
                    'groupby_agg':agg
                };

                pygdf_query(command,params(query),"user requesting groupby for the dimension:"+column_name,callback);

            }catch(ex){
                console.log(ex);
                callback(true,-1);
                clearGPUMem();
            }
        });

        //get top/bottom n rows as per the top n values of columnName
        socket.on('groupby_filterOrder', function(sort_order, column_name,dataset,n,sort_column,agg,callback){
            try{

                let command = 'groupby_filterOrder';
                let query = {
                    'session_id': socket.session_id,
                    'dataset': dataset,
                    'dimension_name': column_name,
                    'groupby_agg':agg,
                    'sort_order': sort_order,
                    'num_rows': n,
                    'sort_column': sort_column
                };

                pygdf_query(command,params(query),"user has requested filterOrder rows for the groupby operation for dimension:"+column_name,callback);

            }catch(ex){
                console.log(ex);
                callback(true,-1);
                clearGPUMem();
            }
        });

         //query the dataframe as per a range-> return results
         socket.on('dimension_filter_range', function(column_name,dataset,range_min,range_max,callback){
            try{
                let command = 'dimension_filter_range';
                let query = {
                    'session_id': socket.session_id,
                    'dataset': dataset,
                    'dimension_name': column_name,
                    'min_value':range_min,
                    'max_value': range_max
                };

                pygdf_query(command,params(query),"user requesting filtering of the dataset as per a range of rows",(error, message) => {
                    if(!error){
                      socket.emit("update_size", dataset, JSON.parse(message)['data']);
                      callback(false,message);
                    }else{
                      console.log(error);
                      callback(error,false);
                    }
                });

            }catch(ex){
                console.log(ex);
                callback(true,-1);
                clearGPUMem();
            }
        });

        //reset all filters on a dimension
        socket.on('dimension_filterAll', function(column_name,dataset, callback){
            try{
                let command = 'dimension_reset';
                let query = {
                    'session_id': socket.session_id,
                    'dataset': dataset,
                    'dimension_name': column_name
                };

                pygdf_query(command,params(query),"user requesting resetting filters on the current dimension",(error, message) => {
                    if(!error){
                      socket.emit("update_size", dataset, JSON.parse(message)['data']);
                      callback(false,message);
                    }else{
                      console.log(error);
                      callback(error,false);
                    }
                });
            }catch(ex){
                console.log(ex);
                callback(true,-1);
                clearGPUMem();
            }
        });


        socket.on('groupby_size', function(column_name,dataset,agg, callback){
            try{
                let command = 'groupby_size';
                let query = {
                    'session_id': socket.session_id,
                    'dataset': dataset,
                    'dimension_name': column_name,
                    'groupby_agg':agg
                };

                pygdf_query(command,params(query),"user requesting size of the groupby",callback);

            }catch(ex){
                console.log(ex);
                callback(true,-1);
                clearGPUMem();
            }
        });

        //get size of the dataset
        socket.on('size', function(dataset,callback){
            try{
                let command = 'get_size';
                let query = {
                    'session_id': socket.session_id,
                    'dataset': dataset
                };

                pygdf_query(command,params(query),"user requesting size of the dataset",callback);

            }catch(ex){
                console.log(ex);
                callback(true,-1);
                clearGPUMem();
            }
        });

        //get top/bottom n rows as per the top n values of columnName
        socket.on('dimension_filterOrder', function(sort_order, column_name, dataset, num_rows, columns,callback){
            try{

                let command = 'dimension_filterOrder';
                let query = {
                    'session_id': socket.session_id,
                    'dataset': dataset,
                    'dimension_name': column_name,
                    'sort_order': sort_order,
                    'num_rows': num_rows,
                    'columns': columns
                };

                pygdf_query(command,params(query),"user has requested top n rows as per the column "+column_name,callback);

            }catch(ex){
                console.log(ex);
                callback(true,-1);
                clearGPUMem();
            }
        });

        //getHist
        socket.on('dimension_getHist', function(column_name,dataset,num_of_bins, callback){
            try{
                let command = 'dimension_hist';
                let query = {
                    'session_id': socket.session_id,
                    'dataset': dataset,
                    'dimension_name': column_name,
                    'num_of_bins': num_of_bins
                };

                pygdf_query(command,params(query),"user requested histogram for "+column_name,callback);

            }catch(ex){
                console.log(ex);
                callback(true,-1);
                clearGPUMem();
            }

        });

        //get Max and Min for a dimension
        socket.on('dimension_getMaxMin', function(column_name,dataset,callback){
            try{

                let command = 'dimension_get_max_min';
                let query = {
                    'session_id': socket.session_id,
                    'dataset': dataset,
                    'dimension_name': column_name
                };
                let comment = "user requested max-min values for "+column_name+" for data="+dataset;

                pygdf_query(command,params(query),comment,callback);

            }catch(ex){
                console.log(ex);
                callback(true,-1);
                clearGPUMem();
            }
        });


        socket.on('disconnect', function(){
        });
        //onClose
        socket.on('endSession', function (dataset,callback) {
            endSession(socket.session_id,dataset, function(error, message){
                callback(error,message);
            });
        });
    });

    return router;
};


function callPyServer(command,query){
  return new Promise((resolve, reject) => {
       let startTime = Date.now();
       let url = pyServerURL+'/'+command+'?'+query
       got(url)
        .then(val => {
          var pyresponse = Buffer.from(val.body).toString('utf8').split(":::");
          var response = {
                        data: pyresponse[0],
                        pythonScriptTime: pyresponse[1],
                        nodeServerTime: Date.now() - startTime
                    }
          resolve(JSON.stringify(response));
        }).catch(error => {
          console.log(error);
          reject(true,error.toString());
        });
  });
}

function params(data) {
  let dataset = data['dataset'];
  let session_id = data['session_id']
  // resetServerTime(dataset,session_id);
  return Object.keys(data).map(key => `${key}=${encodeURIComponent(data[key])}`).join('&');
}

function pygdf_query(command,query, comments,callback){
    callPyServer(command,query)
      .then((message) => {
              console.log(comments);
              callback(false,message);
      }).catch((error) => {
              console.log(error);
              callback(error,false);
      });
}

function endSession(session_id,dataset,callback){
  let startTime = Date.now()
  url = 'http://127.0.0.1:3002/end_connection?session_id='+session_id+'&dataset='+dataset
  got(url)
   .then(val => {
     isDataLoaded[session_id+dataset] = false;
     isConnectionEstablished[session_id+dataset] = false;
     var pyresponse = Buffer.from(val.body).toString('utf8').split(":::");
     var response = {
                   data: pyresponse[1],
                   pythonScriptTime: pyresponse[2],
                   nodeServerTime: Date.now() - startTime
               }
     callback(false,JSON.stringify(response));
   }).catch(error => {
     console.log(error);
     reject(true,error.toString());
   });
    // try{
    //     for(var key in pyClient){
    //         if(key.includes(session_id+dataset)){
    //             pyClient[key].write("exit");
    //             pyClient[key].destroy();
    //             isDataLoaded[key] = false;
    //             isConnectionEstablished[key] = false;
    //         }
    //     }
    //     callback(false,"session ended");
    //
    // }catch(ex){
    //     console.log(ex);
    //     callback(true,-1);
    //     clearGPUMem();
    // }
}

//Utility functions:
function parseCookie(cookie){
    var output = {};
    cookie.split(/\s*;\s*/).forEach(function(pair) {
        pair = pair.split(/\s*=\s*/);
        output[pair[0]] = pair.splice(1).join('=');
    });
    return output['connect.sid'].toString('utf8').split('.')[0].substring(4);
}

setInterval(function(){
    console.log("clearing the clutter");
    console.log(Object.keys(serverOnTime));
    for(var key in serverOnTime){
        if(Date.now() - serverOnTime[key] > 10*60*1000){
            console.log("clearing "+key);
            pyClient[key].write("exit");
            pyClient[key].destroy();
            isDataLoaded[key] = false;
            isConnectionEstablished[key] = false;
        }
    }
},10*59*1000);

function clearGPUMem(){
    console.log(Object.keys(serverOnTime));
    console.log(Object.keys(pyClient));

    for(var key in serverOnTime){
        console.log("clearing "+key);

            // pyClient[key].write("exit");
            // pyClient[key].destroy();
            isDataLoaded[key] = false;
            isConnectionEstablished[key] = false;
    }
}

function process_client_input(session_id, dataset, query){
    return new Promise((resolve, reject) => {
         let startTime = Date.now();
         url = 'http://127.0.0.1:3002/process?session_id='+session_id+'&query='+query
         got(url)
          .then(val => {
            var pyresponse = Buffer.from(val.body).toString('utf8').split(":::");
            var response = {
                          data: pyresponse[1],
                          pythonScriptTime: pyresponse[2],
                          nodeServerTime: Date.now() - startTime
                      }
            resolve(JSON.stringify(response));
          }).catch(error => {
            console.log(error);
            reject(true,error.toString());
          });
    });

    // try{
    //     resetServerTime(dataset,session_id);
    //     if(isConnectionEstablished[session_id+dataset]){
    //         let identifier = query.split(":::")[0];
    //         if(identifier.includes("dimension") || identifier.includes("group")){
    //             identifier = identifier+query.split(":::")[1].split('///')[0];
    //         }
    //         // callback_store[identifier] = callback;
    //         // startTimeStore[identifier] = Date.now();
    //
    //           // utils(Date.now(), session_id, dataset, query);//
    //           // function(result){
    //             // var pyresponse = Buffer.from(result).toString('utf8').split(":::");
    //             // var response = {
    //             //     data: pyresponse[0],
    //             //     pythonScriptTime: pyresponse[1],
    //             //     nodeServerTime: Date.now() - startTime
    //             // }
    //         // });
    //     }else{
    //         var response = {
    //             data: 'No connection established',
    //             pythonScriptTime: 0,
    //             nodeServerTime: Date.now() - startTime
    //         }
    //         return(false,JSON.stringify(response));
    //     }
    // }catch(ex){
    //     console.log(ex);
    //     callback(true,-1);
    //     clearGPUMem();
    // }
}

function resetServerTime(dataset, session_id){
  console.log(dataset);
  console.log(session_id);
    var server_dataset = dataset.split(":::")[0];
    var server_key = session_id+server_dataset;
    serverOnTime[server_key] = Date.now();
}

function create_query(list_of_args){
    if(list_of_args instanceof Array){
        if(list_of_args.length ==0){
            return "number of arguments cannot be zero";
        }
        query = list_of_args[0];
        for(var index=1; index<list_of_args.length; index++){
            if(index == list_of_args.length-1){
                query = query + ":::" +list_of_args[index];
            }else{
                query = query + ":::" +list_of_args[index]
            }
        }
        return query;
    }else{
        return "input has to be an array of arguments";
    }

}
function initConnection(session_id,dataset, callback){
    // var tryAgain = 0;
    // var server_dataset = dataset.split(":::")[0];
    // var server_key = session_id+server_dataset;
    // var threadCount = 'threadCount';
    // console.log("server key"+server_key);
    //
    //
    //
    // if(!(server_key in pyServer) || (server_key in pyServer && pyServer[threadCount+server_key]>1)){
    //     pyServer[threadCount+server_key] = 1;
    //     pyServer[server_key] = spawn('python3', ['../python_scripts/pygdfCrossfilter.py',1]);
    //     console.log("server successfully spawned");
    //     pyServer[server_key].stdout.on('data', function(data) {
    //         console.log('PyServer stdout: ');
    //         console.log(Buffer.from(data).toString('utf8'));
    //     });
    //     pyServer[server_key].stderr.on('data', function(data) {
    //         isConnectionEstablished[session_id+dataset] = false;
    //         pyServer[threadCount+server_key] = 0;
    //         pyClient[session_id+dataset].write("exit");
    //         console.log('PyServer stderr: ');
    //         console.log(Buffer.from(data).toString('utf8'));
    //     });
    // }else{
    //     pyServer[threadCount+server_key]= pyServer[threadCount+server_key] + 1;
    // }
    let startTime = Date.now()

    let url = 'http://127.0.0.1:3002/init_connection?session_id='+session_id+'&dataset='+dataset
    got(url)
      .then(val => {
        console.log(val.body)
        isConnectionEstablished[session_id+dataset] = true
        var pyresponse = Buffer.from(val.body).toString('utf8').split(":::");
        var response = {
                      data: pyresponse[1],
                      pythonScriptTime: pyresponse[2],
                      nodeServerTime: Date.now() - startTime
                  }
        callback(false,JSON.stringify(response));
      }).catch(error => {
        console.log(error);
        isConnectionEstablished[session_id+dataset] = false;
        callback(true,error.toString());
      });

    // pyClient[session_id+dataset] = new net.Socket();
    // pyClient[session_id+dataset].connect(PORT, HOST, function() {
    //     console.log('CONNECTED TO: ' + HOST + ':' + PORT);
    // });
    // pyClient[session_id+dataset].on('error',function(err){
    //     console.log("failed. Trying again... "+err);
    //     if(tryAgain < 3){
    //         setTimeout(function(){
    //               pyClient[session_id+dataset].connect(PORT, HOST, function() {
    //                 });
    //        },1000);
    //
    //        tryAgain= tryAgain+ 1;
    //      }else{
    //         callback(true,err.toString());
    //     }
    //
    // });
    // pyClient[session_id+dataset].on('connect', function(){
    //     isConnectionEstablished[session_id+dataset] = true;
    //     pyClient[session_id+dataset].setNoDelay();
    //     pyClient[session_id+dataset].on('data', function(val){
    //         // console.log(Buffer.from(val).toString('utf8'));
    //         if(Buffer.from(val).toString('utf8').substring(val.length - 4) === '////'){
    //             chunks.push(val);
    //             console.log('reached end');
    //             let data = Buffer.concat(chunks);
    //             chunks = [];
    //             // pyClient[session_id+dataset].removeAllListeners(['data']);
    //             var res_str = Buffer.from(data).toString('utf8');
    //             res_str = res_str.substring(0,res_str.length - 4);
    //             var pyresponse = Buffer.from(res_str).toString('utf8').split(":::");
    //             var identifier = pyresponse.shift();
    //             var response = {
    //                 data: pyresponse[0],
    //                 pythonScriptTime: pyresponse[1],
    //                 nodeServerTime: (Date.now() - startTimeStore[identifier])/1000
    //             }
    //             // if(identifier === 'dimension_filterOrder'){
    //             //     callback_store[identifier](false,data);
    //             // }else{
    //                 callback_store[identifier](false,JSON.stringify(response));
    //             // }
    //         }else{
    //             chunks.push(val);
    //             // console.log(val);
    //         }
    //     });
    //     callback(false,'user has connected to pygdfCrossfilter');
    //
    // });
}


// function loadData(dataset,session_id, callback){
//     try{
//         console.log('inside loaddata');
//         pyClient[session_id+dataset].on('data', function(val){
//             console.log("received data from pyscript");
//             var pyresponse = Buffer.from(val).toString('utf8').split(":::");
//             var response = {
//                 data: pyresponse[0],
//                 pythonScriptTime: pyresponse[1],
//                 nodeServerTime: Date.now() - startTime
//             }
//             // console.log(response);
//             isDataLoaded[session_id+dataset] = true;
//             dataLoaded[session_id+dataset] = dataset;
//             pyClient[session_id+dataset].removeAllListeners(['data']);
//             callback(JSON.stringify(response));
//         });
//         var temp = create_query(['read',dataset]);
//         console.log(temp);
//         pyClient[session_id+dataset].write(temp);
//     }catch(ex){
//         console.log(ex);
//         clearGPUMem();
//     }

// }


function utils(session_id,dataset, query,callback){
    try{
        pyClient[session_id+dataset].write(query);
    }catch(ex){
        console.log(ex);
        clearGPUMem();
    }
}
