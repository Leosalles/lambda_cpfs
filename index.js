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
  console.log('payload: ', payload);

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
    console.log('params: ', params);

    dynamo.put(params, function(err, data) {
      if (err) {
        console.log("Unable to add item. Error JSON:", JSON.stringify(err, null, 2), JSON.stringify(params, null, 2));
        console.error("Unable to add item. Error JSON:", JSON.stringify(err, null, 2), JSON.stringify(params, null, 2));
        context.fail(err);
      } else {
        console.log("Added item:", JSON.stringify(params, null, 2));
      }
    });
  };
  context.succeed("function mandrill succeed!");
  context.done();
};

var clicksign_search = function(event, context){
  event.Records.forEach(function(record) {
    console.log(record.eventID);
    console.log(record.eventName);
    console.log('DynamoDB Record: %j', record.dynamodb);

    bounced_email = record.dynamodb.Keys.email;

    if (bounced_email){
      console.log('bounced_mail: ', bounced_email);
      sender = searchClicksign(bounced_email);

      if (sender){
        sendEmail(sender, bounced_email);
      } else {
        console.log('Bounce with no sender: ', bounced_email);
      }
    } else {
      console.log('No bounced_mail found.');
    }
  });

  context.succeed("function clicksign_search succeed!");
  context.done();
};

function searchClicksign(bounced_email){
  //fatch invite
  url = "https://desk.clicksign.com/admin/invites?email=" + bounced_email.replace('@', '%40');
  body = request.get(url).auth(config['clicksign_auth_user'], config['clicksign_auth_pass']);
  $ = cheerio.load(body);
  var archive = $('a[href*="/admin/archives"]', body)[0].text;
  console.log('archive: ', archive);

  if (archive != ''){
    //fatch archive
    url = "https://desk.clicksign.com/admin/archives/" + archive;
    body = request.get(url).auth(config['clicksign_auth_user'], config['clicksign_auth_pass']);
    $ = cheerio.load(body);
    sender = {
      "name": $('caption').text().split('por ')[1].trim().slice(0,-1).split(' (')[0],
      "mail": $('caption').text().split('por ')[1].trim().slice(0,-1).split(' (')[1]
    };
    console.log('sender: ', sender);
    return sender
  }
}

function sendEmail(sender, bounced_email){
  // dev mode
  sender['email'] = 'mb@clicksign.com'

  // template
  var template = '';
  fs.readFile("mail_template.html", function (err, data) {
    if (err) throw err;
    template = data.toString();
  });
 template = template.replace('{sender_name}', sender['name']);
 template = template.replace('{sender_email}', sender['email']);
 template = template.replace('{bounced_email}', bounced_email);

 var params = {
    Source: config['ses_from'],
    Destination: { ToAddresses: sender_email },
    Message: {
      Subject: { Data: 'E-mail inválido em seu documento' },
      Body: { Html: { Data: template } }
    }
  };

  ses.sendEmail(params, function(err, data){
    if(err) throw err
    console.log('Email sent:');
    console.log(data);
  });
}

exports.handler = function(event, context) {
  console.log('Received event:', JSON.stringify(event, null, 2));

  var operation = '';

  if (event.Records){
    operation = 'clicksign_search';
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
    case 'clicksign_search':
      clicksign_search(event, context);
      break;
    default:
      context.fail(new Error('Unrecognized operation "' + operation + '"'));
  }
};
