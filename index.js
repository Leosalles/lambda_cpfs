var config = require('./config.json')
var AWS = require('aws-sdk');
var uuid = require('node-uuid');
var request = require('request');
var cheerio = require('cheerio');
var fs = require('fs');

AWS.config.region = 'us-east-1';
var dynamo = new AWS.DynamoDB.DocumentClient()
var ses = new AWS.SES({apiVersion: '2010-12-01'});

var mandrill = function(event, context) {
  payload = event['payload']

  for(var i = 0; i < payload.length; i++) {
    var params = {};
    params.TableName = "bounces";
    params.Item = {
      "uuid": uuid.v1(),
      "email": payload[i]['msg']['email'],
      "date": (new Date).getTime(),
      "id": payload[i]['_id'],
      "event": payload[i]['event'],
      "state": payload[i]['msg']['state'],
      "bounce_description": payload[i]['msg']['bounce_description'],
      "diag": payload[i]['msg']['diag']
    };

    dynamo.put(params, function(err, data) {
      if (err) {
        console.error("Unable to add item. Error JSON:", JSON.stringify(err, null, 2), JSON.stringify(params, null, 2));
        context.fail(err);
      } else {
        console.log("Added item:", JSON.stringify(params, null, 2));
      }
    });
  };
  context.succeed();
  context.done();
};

var clicksign_search = function(event, context){
  event.Records.forEach(function(record) {
    console.log(record.eventID);
    console.log(record.eventName);
    console.log('DynamoDB Record: %j', record.dynamodb);
  });

  url = "https://desk.clicksign.com/admin/invites?email=imad%40savan.com.br"
  body = request.get(url).auth(config['clicksign_auth_user'], config['clicksign_auth_pass']);
  $ = cheerio.load(body);
  var archive = $('a[href*="/admin/archives"]', body)[0].text;

  if (archive != ''){
    url = "https://desk.clicksign.com/admin/archives/" + archive;
    body = request.get(url).auth(config['clicksign_auth_user'], config['clicksign_auth_pass']);
    $ = cheerio.load(body);
    var sender_name = $('caption').text().split('por ')[1].trim().slice(0,-1).split(' (')[0];
    var sender_mail = $('caption').text().split('por ')[1].trim().slice(0,-1).split(' (')[1];
  } else {
    context.succeed('Bounce with no sender')
  }
};

function sendEmail(sender_name, sender_email, bounced_email){
  // dev mode
  sender_email = 'mb@clicksign.com'

  // template
  var template = '';
  fs.readFile("mail_template.html", function (err, data) {
    if (err) throw err;
    template = data.toString();
  });
 template = template.replace('{sender_name}', sender_name);
 template = template.replace('{sender_email}', sender_email);
 template = template.replace('{bounced_email}', bounced_email);

 var params = {
    Source: config['ses_from'],
    Destination: { ToAddresses: sender_email },
    Message: {
      Subject: { Data: 'E-mail inválido em seu documento' },
      Body: { Html: { Data: template } }
    }
  };

  ses.sendEmail(params, function(err, data) {
    if(err) throw err
    console.log('Email sent:');
    console.log(data);
  });
}

exports.handler = function(event, context) {
  console.log('Received event:', JSON.stringify(event, null, 2));

  var operation = event.operation;
  delete event.operation;
  if (operation) {
    console.log('Operation', operation, 'requested');
  }

  switch (operation) {
    case 'ping':
      context.succeed('pong');
      break;
    case 'mandrill':
      mandrill(event, context);
      break;
    case 'clicksign_search':
      clicksign_search(event, context);
      break;
    default:
      //context.fail(new Error('Unrecognized operation "' + operation + '"'));
  }
};
