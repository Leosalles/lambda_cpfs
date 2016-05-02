var AWS = require('aws-sdk');
var request = require('request');
var cheerio = require('cheerio');
var config = require('./config.json');
var fs = require('fs');
var async = require('async');

AWS.config.region = 'us-east-1';
var dynamo = new AWS.DynamoDB.DocumentClient();
var ses = new AWS.SES({apiVersion: '2010-12-01'});


	


function getFirstItem(next ){
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
		var username = config['clicksign_auth_user'],
      	password = config['clicksign_auth_pass'],
      	url = 'https://' + username + ':' + password + '@desk.clicksign.com/admin/users?page='+pg.toString();
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
	        	if(uid>48537){
	        		console.log(uid);
		        	var link= $tds.eq(5).html();
		        	var status=1;
		        	if($tds.eq(5).text().trim()=='Verificar'){
		        		status_click='Verificar';
		        		console.log($tds.eq(5).text().trim())
		        	}
		        	if($tds.eq(5).text().trim()=='Verificado'){
		        		status_click='validado';
		        	}
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
		        				"status": status,
		        				"status_clicksign": status_click
		        			}
		        	};
		        	cleanEmptyJson(params);
		        	dynamo.put(params, function(err,data){
		        		if(err){
		        			console.error(err);
		        			 next(new Error('Error in getArchiveFromInvite.'));
		        		} 
		        	});
	        	}
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
		        	var link= $tds.eq(5).html();
		        	if($tds.eq(5).text().trim()=='Verificar'){
		        		status_click='Verificar';
		        		console.log($tds.eq(5).text().trim())
		        	}
			        if($tds.eq(5).text().trim()=='Verificado'){
			        	console.log('válido')
			        	status_click='validado';
			        }
			        if(uid>48537){
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
		        				"status": 1,
		        				"status_clicksign": status_click
		        			}
		        	};
		        	if(status_click=='Verificar'){
			        	var prosIndianos = {
			        	        "cpf": params.Item.CPF,
			        	        "birthday": params.Item.Nascimento,
			        	        "name": params.Item.Nome.trim(),
			        	        "hook_url": 'https://r5dmfsj0kb.execute-api.us-east-1.amazonaws.com/prod/cpf?id='+params.Item.User_ID.toString()
			        	      };
			        	
			        	      var options = {
			        	        uri: 'https://consulta-cpf-staging.herokuapp.com/users',
			        	        method: 'POST',
			        	        json: prosIndianos
			        	      };
	
			        	      request(options, function (error, response, body) {
			        	        if (!error && response.statusCode == 200) {
			        	        	console.log('https://r5dmfsj0kb.execute-api.us-east-1.amazonaws.com/prod/cpf?id='+params.Item.User_ID.toString());
			        	          
			        	        } else {
			        	          console.log(error);
			        	        }
			        	      });
		        	}
		        	
		        	cleanEmptyJson(params);
		        	dynamo.put(params, function(err,data){
		        		if(err){
		        			console.error(err);
		        			 next(new Error('Error in getArchiveFromInvite.'));
		        		} 
		        	});
			        }
		        	i++;
	        	}
		        });
	        console.log(i);
	        if(i>=30){
		        pg=pg+1;
		        process_stream(pg,dataQ);
	        }
	      }
      	}
      },
        
        
        //console.log('archive: ', archive);
      
      
    ]);

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

function pegarPorID(event,next){
	console.log("--validando--");
	var id= parseInt(event.user_id);
	 var params = {
	            TableName: "Users",
	            KeyConditionExpression: "#User_ID = :val",
	            ExpressionAttributeValues:{
	            	":val": id
	            },
	            Limit:1,
	            ExpressionAttributeNames: {
	                "#User_ID": "User_ID"
	              }
	 };
	dynamo.query(params, function(err, data) {
        if (err) {
        	console.log(err);
        	next(err);
        }
        else{
        	console.log('N itens: ',data.Count);
        	if(data.Count==1){
        		next(null,event,data);
        	}
        	else{
        		console.log("algo muito errado aconteceu e retornou mais de um item");
        		next(new Error('ERRO'));
        	}
        }
  });
}

function validarCPF(event,data, next){
	/*

	else if(event.body.error=="error: data de nascimento divergente"){
		//avisar
		next(null,event,data,"data de nascimento divergente");
	}
	else if(event.body.error=="error: cpf incorreto"){
		//avisar
		next(null,event,data,"cpf incorreto");
	}
	else{
		console.log('CPF errado');
		next(null,event,data,"Error: CPF inexistente");
	}*/
	var typeoferror="";
	
	if(event.body.error==""){
		console.log("CPF válido");
		if(event.body.name_clean==event.body.name_gov){
			//apertar o botão de verificar/
			console.log(event.user_id);
			var username = config['clicksign_auth_user'],
	          	password = config['clicksign_auth_pass'],
	          	url = 'https://' + username + ':' + password + "@desk.clicksign.com/admin/users/"+event.user_id+"/verify"
			request.post(url,{form:{_method:"patch"}});
			typeoferror="verificado" ;
		}
		else{
			//Nome não bate, avisar!//
			typeoferror="Nome não bate!" ;
		}
		
	}
	else{
		typeoferror=event.body.error;
	}
	
	dynamo.update({
		TableName:'Users',
		Key:{
			User_ID:parseInt(event.user_id)
			},
		UpdateExpression:'set  #clean= :name_clean ,	#gov= :name_gov , #CPF= :cpf , #nascimento= :birthday , #error=:tError',
		ExpressionAttributeNames:{
			'#clean': 'name_clean' ,
			'#gov': 'name_gov' ,
			'#CPF': 'cpf' ,
			'#nascimento':'birthday',
			'#error':'erro_resposta'
			},
		ExpressionAttributeValues:{
			':name_clean':event.body.name_clean,
			':name_gov':event.body.name_gov,
			':cpf':event.body.cpf,
			':birthday':event.body.birthday,
			':tError':typeoferror
		}
	},function(err, data) {
        if (err) {
        	console.log(err);
        	next(err);
        }
    });
	
}

/*
function sendSlackMessage(event, data,typeOfError, next) {
	var username = config['clicksign_auth_user'],
	  	password = config['clicksign_auth_pass'],
	  	url = 'https://' + username + ':' + password + '@desk.clicksign.com/admin/users/',
	  	color="ff0000";
  	if(typeOfError=="verificado"){
  		color="00ff00";
  	}
  	else if(typeOfError=="Nome não bate!"){
  		color="ffff00";
  	}
	var linkToUser=url+event.user_id;
	var attachJson="[{\"color\":\""+color+"\",\"text\":\"User: " + event.body.name_clean + " \n"+
		"Name: "+ event.body.name_gov +"\n" +
		"CPF:"+ event.body.cpf+"\n"+
		"Data de nascimento (receita): " + event.body.birthday+"\n"+
		"e-mail: "+ data.Items[0]["E-Mail"]+"\""+
		
		", \n" + "\"title\":\"Tome uma ação \"," +
		"\"title_link\":\"" +linkToUser+"\"," +
		"\"fields\":" +
		"[{\n"+
		"\"title\":\"Verificar\",\n"+
		"\"value\":\"<"+"https://r5dmfsj0kb.execute-api.us-east-1.amazonaws.com/prod/cpf?id="+event.user_id+"|aqui>\",\n"+
		"\"short\":true"+"}]"
			+"}]";
    var slackMessage = "token=xoxp-3121000102-10442276772-31921900067-c89c0c317b" +
    		"&channel=%23suporte-verifier" +
    		"&as_user=true"+
    		"&text=ERRO%3A"+typeOfError+
    		"&attachments="+attachJson;
    		
    //slackMessage=encodeURIComponent(JSON.stringify(slackMessage));
    console.log(slackMessage);
    var options = {
      uri: 'https://slack.com/api/chat.postMessage?'+slackMessage,
      method: 'POST'
    };

    request(options, function (error, response, body) {
      if (!error && response.statusCode == 200) {
    	  console.log(JSON.parse(response.body));
    	  ts=(JSON.parse(response.body).ts);
    	  console.log(ts);
        dynamo.update({
			TableName:'Users',
			Key:{User_ID:parseInt(event.user_id)},
			UpdateExpression:'set #slk=:val',
			ExpressionAttributeNames:{'#slk': 'slk_TS'},
			ExpressionAttributeValues:{
				':val': ts
			}
		},function(err, data) {
	        if (err) {
	        	console.log(err);
	        	next(err);
	        }
	    });
      } else {
        next(error);
      }
    });
  }
*/
/*
function updateSlackMessage(event,data,next){
	var username = config['clicksign_auth_user'],
  	password = config['clicksign_auth_pass'],
  	url = 'https://' + username + ':' + password + '@desk.clicksign.com/admin/users/';
	
var slackMessage = "token=xoxp-3121000102-10442276772-31921900067-c89c0c317b" +
		"&channel=C0X3PR7PA"+
		"&ts="+data.Items[0].slk_TS+
		"&text=Verificado"+
		"&attachments=%5B%5D";
		
//slackMessage=encodeURIComponent(JSON.stringify(slackMessage));
console.log(slackMessage);
console.log(data);
var options = {
  uri: 'https://slack.com/api/chat.update?'+slackMessage,
  method: 'POST'
};

request(options, function (error, response, body) {
  if (!error && response.statusCode == 200) {
    console.log(response.body);
  } else {
    next(error);
  }
});
	
}
*/

function pegarLista(next){
	var params = {
            TableName: "Users",
            IndexName: "status-Date-index",
            KeyConditionExpression: "#status = :val ",
            FilterExpression: "(#status_clicksign <> :valid AND #status_clicksign <> :verified AND #err <>:verified) AND attribute_exists(#name_clean)",
            ExpressionAttributeNames: {
            	"#status_clicksign":"status_clicksign",
            	"#name_clean":"name_clean",
                "#status": "status",
                "#err": "erro_resposta"
              },
            ExpressionAttributeValues:{
            	":val":1,
            	":valid":"validado",
            	":verified":"verificado"
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

function montarHtml(data,next){
	var stumpHtml="";
	var username = config['clicksign_auth_user'],
  		password = config['clicksign_auth_pass'],
  		url = 'https://' + username + ':' + password + '@desk.clicksign.com/admin/users/';
	console.log(data.Count);
	if(data.Count>0){
		data.Items.forEach(function(elem){
			var gov='';
			if(!elem['name_gov']){
				gov="NAO APRESENTA";
			}
			if(elem['name_gov']){
				gov=elem['name_gov'].toString();
			}
			var cpf='';
			if(!elem['cpf']){
				cpf="NAO APRESENTA";
			}
			if(elem['cpf']){
				cpf=elem['cpf'].toString();
			}
			
		htmlP1='<table style ="width:100%">'+
			'<tr>'+'<th rowspan="5">'
				+elem['User_ID'].toString()+
				'<td>'+elem['name_clean'].toString()+'</td>'+
			'</tr>'+
			'<tr>'+
				'<td>'+gov+'</td>'+
			'</tr>'+
			'<tr>'+
				'<td>'+cpf+'</td>'+
			'</tr>'+
			'<tr>'+
				'<td>'+elem['birthday'].toString()+'</td>'+
				'<td>'+'<a href="'+url+elem['User_ID'].toString()+'" target="_blank"> Link para usuario</a>'+'</td>'+
			'</tr>'+
			'<tr>'+
				'<td>'+elem['erro_resposta'].toString()+'</td>'+
				'<td>'+'<a href="'+"https://r5dmfsj0kb.execute-api.us-east-1.amazonaws.com/prod/validar?id="+elem['User_ID'].toString()+'" target="_blank"> valido </a>'+'</td>'+
			'</tr></table><br>';
		stumpHtml=stumpHtml.concat(htmlP1);
		});
	}
	next(null, data,stumpHtml);
}


function imprimirHtml(data,hmtlPt, next){
	var html='<html><head><title> Users</title></head>'+
	'<style>table, th, td '+
	'{border: 1px solid black;border-collapse: collapse;}th, td {padding: 5px;text-align: left;}</style><body>'+
	hmtlPt+
	'</body></html>';
	next(null, data,hmtlPt,html);
}

exports.handler = function(event, context) {
	
	//var arrayUsers= $('tr').each(function(){console.log($(this).find('td:eq(0)').text());console.log($(this).find('td:eq(1)').text());console.log($(this).find('td:eq(5)').html());});
	//console.log(arrayUsers);
	if(event.type=="valide"){
		if(event.id==null){
			context.succeed("sem ID");
		}
		else{
			console.log(event.id);
			var username = config['clicksign_auth_user'],
	          	password = config['clicksign_auth_pass'],
	          	url = 'https://' + username + ':' + password + "@desk.clicksign.com/admin/users/"+event.id+"/verify";
			request.post(url,{form:{_method:"patch"}});
			console.log("verificado");
			dynamo.update({
				TableName:'Users',
				Key:{
					User_ID:parseInt(event.id)
					},
				UpdateExpression:'set  #error=:tError',
				ExpressionAttributeNames:{
					'#error':'erro_resposta'
					},
				ExpressionAttributeValues:{
					':tError': 'verificado'
				}
			},function(err, data) {
		        if (err) {
		        	console.log(err);
		        	next(err);
		        }
			})
		}
	}
	else if(event.type=="web"){
			async.waterfall([
			                 pegarLista,
			                 montarHtml,
		imprimirHtml
			                 ], function (err, data,htmlP1,html){
				context.succeed(html)
			});
			
		}
	else {
		if(event.user_id==null){
			async.waterfall([
			                 getFirstItem
			                ],
			    function( err, result){
					process_stream(1,result);
				}
			);
			console.log('Received event:', JSON.stringify(event, null, 2));
			
		}
		
		if(event.user_id!=null){
			if(event.type=="validar"){
				async.waterfall([
				     async.apply(pegarPorID, event),
				     validarCPF,
				     //sendSlackMessage
				]);
			}
			else if(event.type=="update"){
				async.waterfall([
							     async.apply(pegarPorID, event),
							     //updateSlackMessage
							]);
			}
			
		};
	}
	
	
  
};
