var config = require('./config.json')
var AWS = require('aws-sdk');
var uuid = require('node-uuid');
var request = require('request');
var https = require('https');
var cheerio = require('cheerio');
var fs = require('fs');
  var async = require('async');

AWS.config.region = 'us-east-1';
var dynamo = new AWS.DynamoDB.DocumentClient()
var ses = new AWS.SES({apiVersion: '2010-12-01'});

var mandrill = function(event, context) {
  payload = event['payload']
  console.log('payload: ', payload);

  var k = 0;
  var params = {};
  var params = {
    RequestItems: {
      'bounces': [
        {
          PutRequest: {
            Item: {
              HashKey: 'anotherKey',
              NumAttribute: 1,
              BoolAttribute: true,
              ListAttribute: [1, 'two', false],
              MapAttribute: { foo: 'bar' }
            }
          }
        }
      ]
    }
  };

  var params = {
    "RequestItems" : {},
  };

  //table name
  params.RequestItems.bounces = [];

  for(var i = 0; i < payload.length; i++) {
    params.RequestItems.bounces.push({
      "PutRequest" : {
        "Item" : {
          "uuid": uuid.v1(),
          "email": payload[i]['msg']['email'],
          "date": (new Date).getTime(),
          "id": payload[i]['_id'],
          "event": payload[i]['event'],
          "state": payload[i]['msg']['state'],
          "bounce_description": payload[i]['msg']['bounce_description'],
          "diag": payload[i]['msg']['diag']
        }
      }
    });
  }

  console.log('params: ', params);

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
  event.Records.forEach(function(record) {
    console.log(record.eventID);
    console.log(record.eventName);
    console.log('DynamoDB Record: %j', record.dynamodb);

    async.waterfall([
      function getBouncedEmail(next){
        bounced_email = record.dynamodb.NewImage.email.S;
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
            console.log('body: ', body);
            next(null, bounced_email, body);
          } else {
            next(error);
          }
        });
      },

      function getArchiveFromInvite(bounced_email, invitesBody, next){
        var body = cheerio.load(invitesBody);
        var archive = body('a[href*="/admin/archives"]').first().text();
        console.log('archive: ', archive);

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
            console.log('body: ', body);
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

      //function checkIfWasSent(sender, next){

      //},

      function getTemplate(bounced_email, sender, next){
        fs.readFile("mail_template.html", function (err, data) {
          if (err){
            next(err);
          } else {
            console.log('template: ', data.toString());
            next(null, bounced_email, sender, data.toString());
          }
        });
      },

      function sendEmail(bounced_email, sender, template, next){
        console.log('template: ', template);
        template = template.replace('{sender_name}', sender['name']);
        template = template.replace('{sender_email}', sender['email']);
        template = template.replace('{bounced_email}', bounced_email);

        var params = {
           Source: config['ses_from'],
           Destination: {
             ToAddresses: [ config['ses_from'] ] //sender['email']
             //, BccAddresses: [ 'suporte@clicksign.com' ]
           },
           Message: {
             Subject: { Data: 'E-mail inválido em seu documento' },
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

      //},

      //function updateTable(sender, next){

       }
    ], function (err, result) {
      if (err) {
        console.error('Failed to publish notifications: ', err);
      } else {
        console.log('Successfully published all notifications.');
        //context.succeed("function clicksign_search succeed!");
        //context.done();
      }
    });
  });

};



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
