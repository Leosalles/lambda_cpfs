var AWS = require('aws-sdk');
AWS.config.region = 'us-east-1';
var dynamo = new AWS.DynamoDB.DocumentClient()
var uuid = require('node-uuid');

exports.handler = function(event, context) {
  //console.log('Received event:', JSON.stringify(event, null, 2));

  for(var i = 0; i < event.length; i++) {
    var params = {};
    params.TableName = "bounces";
    params.Item = {
      "uuid": uuid.v1(),
      "email": event[i]['msg']['email'],
      "date": (new Date).getTime(),
      "id": event[i]['_id'],
      "event": event[i]['event'],
      "state": event[i]['msg']['state'],
      "bounce_description": event[i]['msg']['bounce_description'],
      "diag": event[i]['msg']['diag']
    };

    dynamo.put(params, function(err, data) {
      if (err) {
        console.error("Unable to add item. Error JSON:", JSON.stringify(err, null, 2), JSON.stringify(params, null, 2));
        context.fail(err);
      } else {
        console.log("Added item:", JSON.stringify(params, null, 2));
      }
    });
  }
  context.succeed;
};
