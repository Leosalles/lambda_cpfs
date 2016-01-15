var config = require('./config.json')
var AWS = require('aws-sdk');
var uuid = require('node-uuid');
var request = require('request');
var cheerio = require('cheerio');
var fs = require('fs');
var async = require('async');

AWS.config.region = 'us-east-1';
var dynamo = new AWS.DynamoDB.DocumentClient()
var ses = new AWS.SES({apiVersion: '2010-12-01'});

var mandrill = function(event, context) {
  payload = event['payload']
  //console.log('payload: ', payload);

  var params = {
    "RequestItems" : {},
  };

  //table name
  params.RequestItems.bounces = [];

  for(var i = 0; i < payload.length; i++) {
    params.RequestItems.bounces.push({
      "PutRequest" : {
        "Item" : {
          "uuid": uuid.v4(),
          "email": payload[i]['msg']['email'],
          "date": (new Date).getTime(),
          "id": payload[i]['_id'],
          "event": payload[i]['event'],
          "state": payload[i]['msg']['state'],
          "bounce_description": payload[i]['msg']['bounce_description'],
          //TODO: only if not null
          //"errorMessage": "One or more parameter values were invalid: An AttributeValue may not contain an empty string",
          "diag": payload[i]['msg']['diag']
        }
      }
    });
  }

  cleanEmptyJson(params)

  //console.log('params: ', params);

  dynamo.batchWrite(params, function(err, data) {
    if (err){
      console.log("Unable to add item. Error JSON:", JSON.stringify(err, null, 2), JSON.stringify(params, null, 2));
      context.fail(err);
    } else {
      console.log("Added item:", JSON.stringify(data, null, 2), JSON.stringify(params, null, 2));
      context.succeed("function mandrill succeed!");
    }
  });
};

var process_stream = function(event, context){
  async.waterfall([
    function getBouncedEmail(next){
      console.log(event.Records[0].eventID);
      console.log(event.Records[0].eventName);
      console.log('DynamoDB Record: %j', event.Records[0].dynamodb);
      bounced_email = event.Records[0].dynamodb.NewImage.email.S;
      if (bounced_email){
        console.log('bounced_email: ', bounced_email);
        next(null, bounced_email);
      } else {
        next(new Error('No bounced_mail found.'));
      }
    },

    function getClicksignInvite(bounced_email, next){
      var username = config['clicksign_auth_user'],
          password = config['clicksign_auth_pass'],
          url = 'https://' + username + ':' + password + '@desk.clicksign.com/admin/invites?email=' + bounced_email.replace('@', '%40');
      console.log('url: ', url);
      request({url: url}, function (error, response, body) {
        if (!error && response.statusCode == 200) {
          //console.log('body: ', body);
          //console.log('statuscode: ', statusCode)
          next(null, bounced_email, body);
        } else {
          next(new Error('Error in getClicksignInvite.'));
        }
      });
    },

    function getArchiveFromInvite(bounced_email, invitesBody, next){
      if (invitesBody){
        console.log('invitesBody: ', invitesBody);
        var body = cheerio.load(invitesBody);
        console.log('body: ', body);
        var archive = body('a[href*="/admin/archives"]').first().text();
        console.log('archive: ', archive);
      }
      if (archive){
        next(null, bounced_email, archive)
      } else {
        next(new Error('Error in getArchiveFromInvite.'));
      }
    },

    function getClicksignArchive(bounced_email, archive, next){
      var username = config['clicksign_auth_user'],
          password = config['clicksign_auth_pass'],
          url = 'https://' + username + ':' + password + '@desk.clicksign.com/admin/archives/' + archive;
      console.log('url: ', url);
      request({url: url}, function (error, response, body) {
        if (!error && response.statusCode == 200) {
          //console.log('body: ', body);
          next(null, bounced_email, body);
        } else {
          next(error);
        }
      });

    },

    function getSenderFromArchive(bounced_email, archivesBody, next){
      var body = cheerio.load(archivesBody);
      var archive = body('a[href*="/admin/archives"]').first().text();
      var sender = {
        "name": body('caption').text().split('por ')[1].trim().slice(0,-1).split(' (')[0],
        "email": body('caption').text().split('por ')[1].trim().slice(0,-1).split(' (')[1]
      };
      console.log('sender: ', sender);

      if (sender){
        next(null, bounced_email, sender)
      } else {
        next(new Error('Error in getSenderFromArchive.'));
      }
    },

    function checkIfWasSent(bounced_email, sender, next){
      var yesterday = new Date();
      yesterday = yesterday.setDate(yesterday.getDate() - 1);

      var params = {
        TableName: "bounces",
        IndexName: "email-date-index",
        FilterExpression: "#email = :email AND #date > :date",
        ExpressionAttributeNames: {
          "#email": "email",
          "#date": "date"
        },
        ExpressionAttributeValues: {
          ":email": bounced_email,
          ":date": yesterday
        }
      };

      dynamo.scan(params, function(err, data) {
        if (err) {
          console.log("Query error. Data + Params:", JSON.stringify(data, null, 2), JSON.stringify(params, null, 2));
          next(err);
        } else {
          console.log("Query succeeded. Data + Params:", JSON.stringify(data, null, 2), JSON.stringify(params, null, 2));
          if (data.Count == 1){
            console.log("Não foi enviado notificação desde ontem.");
            next(null, bounced_email, sender);
          } else {
            console.log("Notificações enviadas desde ontem:", JSON.stringify(data.Items, null, 2));
            next(new Error('Notificações enviadas anteriormente.'));
          }
        }
      });
    },

    function getTemplate(bounced_email, sender, next){
      bounce_description = event.Records[0].dynamodb.NewImage.bounce_description.S;
      if (bounce_description.split(',')[0] == 'mailbox_full'){
        template_file = 'mailbox_full_template.html';
      } else {
        template_file = 'mailbox_bounce_template.html';
      }
      fs.readFile(template_file, function (err, data) {
        if (err){
          next(err);
        } else {
          //console.log('template: ', data.toString());
          next(null, bounced_email, sender, data.toString());
        }
      });
    },

    function sendEmail(bounced_email, sender, template, next){
      //console.log('template: ', template);
      template = template.replace('{sender_name}', sender['name']);
      template = template.replace('{sender_email}', sender['email']);
      template = template.replace('{bounced_email}', bounced_email);

      var params = {
         Source: config['ses_from'],
         Destination: {
           ToAddresses: [ config['ses_from'] ] //sender['email']
           , BccAddresses: [ 'suporte@clicksign.com' ]
         },
         Message: {
           Subject: { Data: 'E-mail não entregue ao destinatário' },
           Body: { Html: { Data: template } }
         }
       };

       ses.sendEmail(params, function(err, data){
        if (err){
          next(err);
        } else {
          console.log('Email sent: ', data);
          next(null, bounced_email, sender)
        }
       });
     }
  ], function (err, result) {
       if (err) {
         context.succeed('An error has occurred: ' +  err);
       } else {
         context.succeed('Successfully processed process_stream');
       }
  });
};

function cleanEmptyJson(x) {
  var type = typeof x;
  if (x instanceof Array) {
    type = 'array';
  }
  if ((type == 'array') || (type == 'object')) {
    for (k in x) {
      var v = x[k];
      if ((v === '') && (type == 'object')) {
        delete x[k];
      } else {
        cleanEmptyJson(v);
      }
    }
  }
}

exports.handler = function(event, context) {
  console.log('Received event:', JSON.stringify(event, null, 2));

  var operation = '';

  if (event.Records){
    operation = 'process_stream';
  } else if (event.operation){
    operation = event.operation;
    delete event.operation;
  }

  console.log('Operation', operation, 'requested');

  switch (operation) {
    case 'ping':
      context.succeed('pong');
      break;
    case 'mandrill':
      mandrill(event, context);
      break;
    case 'process_stream':
      process_stream(event, context);
      break;
    default:
      context.fail(new Error('Unrecognized operation "' + operation + '"'));
  }
};
