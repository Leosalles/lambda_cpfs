var AWS = require('aws-sdk');
var uuid = require('node-uuid');
var request = require('request');
var cheerio = require('cheerio');
var fs = require('fs');
var async = require('async');
var uuid=require('node-uuid');

AWS.config.region = 'us-east-1';
var dynamo = new AWS.DynamoDB.DocumentClient();
var ses = new AWS.SES({apiVersion: '2010-12-01'});


	
function slackMessageJSON(payload, i){
  console.log(payload);
  var slackMessage = {
    "channel": "#suporte-int",
    "username": "Postmark",
    "icon_emoji": ":mandrill:",
    "text": "*Bounce received* " + payload[i]['Email'],
    "attachments": [
      {
        "fallback": "Bounce received " + payload[i]['Email'],
        "color": "#E3E4E6",
        "fields": []
      }
    ]
  };

  if (payload[i]['Name']) {
    slackMessage.attachments[0].fields.push(
      {
        "title": "Event",
        "value": payload[i]['Name'],
        "short": true
      }
    );
  }

  if (payload[i]['Description']){
    slackMessage.attachments[0].fields.push(
      {
        "title": "Description",
        "value": payload[i]['Description'],
        "short": true
      }
    );
  }

  if (payload[i]['Details']){
    slackMessage.attachments[0].fields.push(
      {
        "title": "Message",
        "value": payload[i]['Details'],
        "short": false
      }
    );
  }

  return slackMessage;
}

function getFirstItem(next ){
    var yesterday = new Date();
    yesterday = yesterday.getFullYear()*10000+yesterday.getMonth()*100+yesterday.getDate()-1;
    var params = {
            TableName: "Users",
            IndexName: "status-Date-index",
            KeyConditionExpression: "#status = :val AND #Date>:val",
            ExpressionAttributeValues:{
            	":val":1
            },
            Limit:1,
            ExpressionAttributeNames: {
                "#status": "status",
                "#Date":"Date"
              },
            ScanIndexForward: false
          };

      dynamo.query(params, function(err, data) {
            if (err) {
            	console.log(err);
            	next( err);
            }
            else{
            	next(null, data);
            }
      });
}

function process_stream( pg,dataQ){
  async.waterfall([


                   
    function getClicksignInvite(  next){
		if(pg==null){
			console.log("Sem PG");
			next(new Error('Error in getClicksignInvite.'));
		}
          url = 'https://michael:oobeeTh7@desk.clicksign.com/admin/users?page='+pg.toString();
      console.log('url: ', url);
      request({url: url}, function (error, response, body) {
        if (!error && response.statusCode == 200) {
          //console.log('body: ', body);
          //console.log('statuscode: ', statusCode)
          next(null,body);
        } 
        else {
        	console.log('pg: ',pg);
        	console.log('err');
          next(new Error('Error in getClicksignInvite.'));
        }
      });
    },

    function getArchiveFromInvite( invitesBody, next){
    	console.log('aqui');
    	if(dataQ.Count==0){
	      if (invitesBody){
	    	  
	        var $ = cheerio.load(invitesBody);
	        var archive = $('tbody').find('tr').each(function(){
	        	var $tds= $(this).find('td');
	        	var uidStr=$tds.eq(0).find('a').attr('href');
	        	uidStr=uidStr.substring(13);
	        	var uid=parseInt(uidStr);
	        	var params={
	        			TableName: "Users",
	        			Item: {
	        				"User_ID":uid,
	        				"Date": Date.parse($tds.eq(3).text()),
	        				"Nome": $tds.eq(0).text(),
	        				"CPF": $tds.eq(1).text(),
	        				"E-Mail": $tds.eq(2).text(),
	        				"Nascimento": $tds.eq(4).text(),
	        				"Link":$tds.eq(5).html(),
	        				"status": 1
	        			}
	        	};
	        	cleanEmptyJson(params);
	        	dynamo.put(params, function(err,data){
	        		if(err){
	        			console.error(err);
	        			 next(new Error('Error in getArchiveFromInvite.'));
	        		} 
	        	});
	        });
	        pg=pg+1;
	        process_stream(pg,dataQ);
	      }
    	}
    	else {
    		var dataQID=parseInt(dataQ.Items[0].User_ID);
    		
  	      console.log(dataQID);
  	      if (invitesBody){
	    	  
	        var $ = cheerio.load(invitesBody);
	        var i=1;
	        var archive = $('tbody').find('tr').each(function(){
	        	var $tds= $(this).find('td');
	        	var uidStr=$tds.eq(0).find('a').attr('href');
	        	uidStr=uidStr.substring(13);
	        	var uid=parseInt(uidStr);
	        	if(uid>dataQID){
		        	var params={
		        			TableName: "Users",
		        			Item: {
		        				"User_ID":uid,
		        				"Date": Date.parse($tds.eq(3).text()),
		        				"Nome": $tds.eq(0).text(),
		        				"CPF": $tds.eq(1).text(),
		        				"E-Mail": $tds.eq(2).text(),
		        				"Nascimento": $tds.eq(4).text(),
		        				"Link":$tds.eq(5).html(),
		        				"status": 1
		        			}
		        	};
		        	cleanEmptyJson(params);
		        	dynamo.put(params, function(err,data){
		        		if(err){
		        			console.error(err);
		        			 next(new Error('Error in getArchiveFromInvite.'));
		        		} 
		        	});
		        	i++;
	        	}
		        });
	        if(i==30){
		        pg=pg+1;
		        process_stream(pg,dataQ);
	        }
	      }
      	}
      },
        
        
        //console.log('archive: ', archive);
      
      
    ]);
/*
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
        next(null, bounced_email, sender);
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
      if (event.Records[0].dynamodb.NewImage.bounce_description){
        bounce_description = event.Records[0].dynamodb.NewImage.bounce_description.S;
      } else {
        bounce_description = 'rejected';
      }
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
           ToAddresses: [ sender['email'] ]
           , BccAddresses: [ config['ses_from'] ]
         },
         Message: {
           Subject: { Data: 'E-mail não entregue ao destinatário' },
           Body: { Html: { Data: template } }
         }
       };

       ses.sendEmail(params, function(err, data){
        if (err) {
          next(err);
        } else {
          console.log('Email sent: ', data);
          next(null, bounced_email, sender);
        }
       });
     },

    function sendSlackEmail(bounced_email, sender, next) {
      var slackMessage = {
        "channel": "#suporte-int",
        "username": "Clicksign",
        "icon_emoji": ":cs:",
        "text": "*Bounce notification* send to " + sender['name'] + " " + sender['email'] + " about bounced e-mail " + bounced_email + "."
      };

      var options = {
        uri: 'https://hooks.slack.com/services/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',
        method: 'POST',
        json: slackMessage
      };

      request(options, function (error, response, body) {
        if (!error && response.statusCode == 200) {
          //console.log('body: ', body);
          next(null);
        } else {
          next(error);
        }
      });
    }

  ], function (err, result) {
       if (err) {
         context.succeed('An error has occurred: ' +  err);
       } else {
         context.succeed('Successfully processed process_stream');
       }
  });*/
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

function getPosition(str,m,i){
	return str.split(m,i).SourceNode.prototype.join(m).length;
}

exports.handler = function(event, context) {
	
	//var arrayUsers= $('tr').each(function(){console.log($(this).find('td:eq(0)').text());console.log($(this).find('td:eq(1)').text());console.log($(this).find('td:eq(5)').html());});
	//console.log(arrayUsers);
	async.waterfall([
	getFirstItem
	],
	function( err, result){
		process_stream(1,result);
	}
	);
  console.log('Received event:', JSON.stringify(event, null, 2));
/*
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
    case 'postmark':
      postmark(event, context);
      break;
    case 'process_stream':
      process_stream(event, context);
      break;
    default:
      //context.fail(new Error('Unrecognized operation "' + operation + '"'));
  }
  */
};
