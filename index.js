var AWS = require('aws-sdk');
var request = require('request');
var cheerio = require('cheerio');
var config = require('./config.json');
var fs = require('fs');
var async = require('async');

AWS.config.region = 'us-east-1';
var dynamo = new AWS.DynamoDB.DocumentClient();
var ses = new AWS.SES({
  apiVersion: '2010-12-01'
});

//Pega o primeiro item da DynamoDB
function getFirstItem(next) {
  var params = {
    TableName: "Users",
    IndexName: "status-Date-index",
    KeyConditionExpression: "#status = :val AND #Date>:val",
    ExpressionAttributeValues: {
      ":val": 1
    },
    Limit: 1,
    ExpressionAttributeNames: {
      "#status": "status",
      "#Date": "Date"
    },
    ScanIndexForward: false
  };

  dynamo.query(params, function(err, data) {
    if (err) {
      console.log(err);
      //next(err);
    } else {
      next(null, data);
    }
  });
}
//inicia o processo de pegar usuários
function process_stream(pg, dataQ) {
  async.waterfall([
    function getClicksignUser(next) {
      if (pg == null) {
        next(new Error('Error in getClicksignUser.'));
      }
      var username = config['clicksign_auth_user'],
        password = config['clicksign_auth_pass'],
        url = 'https://' + username + ':' + password + '@desk.clicksign.com/admin/users?page=' + pg.toString();
      console.log('url: ', url);
      request({
        url: url
      }, function(error, response, body) {
        if (!error && response.statusCode == 200) {
          //console.log('body: ', body);
          //console.log('statuscode: ', statusCode)
          next(null, body);
        } else {
          console.log('pg: ', pg);
          console.log('err');
          next(new Error('Error in getClicksignUser.'));
        }
      });
    },

//roda todas as páginas gravando os usuários na DB e procurando o primeiro registrado anteriormente

    function getAllPages(invitesBody, next) {
      
        var dataQID = parseInt(dataQ.Items[0].User_ID);
        console.log(dataQID);
        if (invitesBody) {
          var $ = cheerio.load(invitesBody);
          var i = 1;
          var archive = $('tbody').find('tr').each(function() {
            var $tds = $(this).find('td');
            var uidStr = $tds.eq(0).find('a').attr('href');
            uidStr = uidStr.substring(13);
            var uid = parseInt(uidStr);
            if (uid > dataQID) {
              var link = $tds.eq(5).html();
              if ($tds.eq(5).text().trim() == 'Verificar') {
                status_click = 'Verificar';
                console.log($tds.eq(5).text().trim())
              }
              if ($tds.eq(5).text().trim() == 'Verificado') {
                console.log('válido')
                status_click = 'validado';
              }
              if (uid > 48537) {
                var params = {
                  TableName: "Users",
                  Item: {
                    "User_ID": uid,
                    "Date": Date.parse($tds.eq(3).text()),
                    "Nome": $tds.eq(0).text(),
                    "CPF": $tds.eq(1).text(),
                    "E-Mail": $tds.eq(2).text(),
                    "Nascimento": $tds.eq(4).text(),
                    "Link": $tds.eq(5).html(),
                    "status": 1,
                    "status_clicksign": status_click
                  }
                };
                if (status_click == 'Verificar') {
                  var prosIndianos = {
                    "cpf": params.Item.CPF,
                    "birthday": params.Item.Nascimento,
                    "name": params.Item.Nome.trim(),
                    "hook_url": 'https://r5dmfsj0kb.execute-api.us-east-1.amazonaws.com/prod/cpf?id=' + params.Item.User_ID.toString()
                  };
                  var options = {
                    uri: 'https://consulta-cpf-staging.herokuapp.com/users',
                    method: 'POST',
                    json: prosIndianos
                  };
                  request(options, function(error, response, body) {
                    if (!error && response.statusCode == 200) {
                      console.log('https://r5dmfsj0kb.execute-api.us-east-1.amazonaws.com/prod/cpf?id=' + params.Item.User_ID.toString());
                      //console.log(prosIndianos);
                    } else {
                      console.log(error);
                    }
                  });
                }
                cleanEmptyJson(params);
                dynamo.put(params, function(err, data) {
                  if (err) {
                    console.error(err);
                    next(new Error('Error in getAllPages.'));
                  }
                });
              }
              i++;
            }
          });
          console.log(i);
          if (i >= 30) {
            pg = pg + 1;
            process_stream(pg, dataQ);
          }
        }
      
    },
    //Michael: Aqui precisa ter o tratamento de erro ou sucesso da função context.
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

//Procura o usuário passado no evento

function pegarPorID(event, next) {
  console.log("--validando--");
  var id = parseInt(event.user_id);
  var params = {
    TableName: "Users",
    KeyConditionExpression: "#User_ID = :val",
    ExpressionAttributeValues: {
      ":val": id
    },
    Limit: 1,
    ExpressionAttributeNames: {
      "#User_ID": "User_ID"
    }
  };
  dynamo.query(params, function(err, data) {
    if (err) {
      console.log(err);
      next(err);
    } else {
      next(null, event, data);
    }
  });
}

// ver de quem são os invites

function getSenderFromInvites(){
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
    }])
}

//processo de validação em si

function validarCPF(event, data, next) {
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
  var typeoferror = "";

  if (event.body.error == "") {
    console.log("CPF válido");
    if (event.body.name_clean == event.body.name_gov) {
      //apertar o botão de verificar/
      console.log(event.user_id);
      var username = config['clicksign_auth_user'],
        password = config['clicksign_auth_pass'],
        url = 'https://' + username + ':' + password + "@desk.clicksign.com/admin/users/" + event.user_id + "/verify"
      request.post(url, {
        form: {
          _method: "patch"
        }
      });
      typeoferror = "verificado";
    } else {
      //Nome não bate, avisar!//
      typeoferror = "Nome não bate!";
    }

  } else {
    typeoferror = event.body.error;
  }

  if (typeoferror !="verificado"){


  }


  dynamo.update({
    TableName: 'Users',
    Key: {
      User_ID: parseInt(event.user_id)
    },
    UpdateExpression: 'set  #clean= :name_clean ,  #gov= :name_gov , #CPF= :cpf , #nascimento= :birthday , #error=:tError',
    ExpressionAttributeNames: {
      '#clean': 'name_clean',
      '#gov': 'name_gov',
      '#CPF': 'cpf',
      '#nascimento': 'birthday',
      '#error': 'erro_resposta'
    },
    ExpressionAttributeValues: {
      ':name_clean': event.body.name_clean,
      ':name_gov': event.body.name_gov,
      ':cpf': event.body.cpf,
      ':birthday': event.body.birthday,
      ':tError': typeoferror
    }
  }, function(err, data) {
    if (err) {
      console.log(err);
      next(err);
    }
  });
}



//lista da DB para visualização 

function pegarLista(next) {
  var params = {
    TableName: "Users",
    IndexName: "status-Date-index",
    KeyConditionExpression: "#status = :val",
    FilterExpression: "(#status_clicksign <> :valid AND #status_clicksign <> :verified AND #err <>:verified) AND attribute_exists(#name_clean)",
    ExpressionAttributeNames: {
      "#status_clicksign": "status_clicksign",
      "#name_clean": "name_clean",
      "#status": "status",
      "#err": "erro_resposta"
    },
    ExpressionAttributeValues: {
      ":val": 1,
      ":valid": "validado",
      ":verified": "verificado"
    },
    ScanIndexForward: false
  };

  dynamo.query(params, function(err, data) {
    if (err) {
      console.log(err);
      next(err);
    } else {
      next(null, data);
    }
  });
}

//html

function montarHtml(data, next) {
  var username = config['clicksign_auth_user'],
    password = config['clicksign_auth_pass'],
    url = 'https://' + username + ':' + password + '@desk.clicksign.com/admin/users/';
  console.log(data.Count);
  if (data.Count > 0) {
    var html = '<html><head><title>Users</title></head>' +
      '<style>table, th, td ' +
      '{border: 1px solid black;border-collapse: collapse;}th, td {padding: 5px;text-align: left;}</style><body>';
    data.Items.forEach(function(elem) {
      var gov = '';
      if (!elem['name_gov']) {
        gov = "NAO APRESENTA";
      }
      if (elem['name_gov']) {
        gov = elem['name_gov'].toString();
      }
      var cpf = '';
      if (!elem['cpf']) {
        cpf = "NAO APRESENTA";
      }
      if (elem['cpf']) {
        cpf = elem['cpf'].toString();
      }

      html += '<table style ="width:100%">' +
        '<tr>' + '<th rowspan="5">' +
        elem['User_ID'].toString() +
        '<td>' + elem['name_clean'].toString() + '</td>' +
        '</tr>' +
        '<tr>' +
        '<td>' + gov + '</td>' +
        '</tr>' +
        '<tr>' +
        '<td>' + cpf + '</td>' +
        '</tr>' +
        '<tr>' +
        '<td>' + elem['birthday'].toString() + '</td>' +
        '<td>' + '<a href="' + url + elem['User_ID'].toString() + '" target="_blank">Link para usuario</a>' + '</td>' +
        '</tr>' +
        '<tr>' +
        '<td>' + elem['erro_resposta'].toString() + '</td>' +
        '<td>' + '<a href="' + "https://r5dmfsj0kb.execute-api.us-east-1.amazonaws.com/prod/validar?id=" + elem['User_ID'].toString() + '" target="_blank">valido</a>' + '</td>' +
        '</tr></table><br>';
    });
    html += '</body></html>';
  }
  next(null, html);
}

// controller de envio de emails.

function emailSender(){
  //TODO: separar por empresa
  async.waterfall([
      pegarLista,
      montarHtml
    ], function(err, html) {
      var params={
        Source: config['ses_from'],
        Destination:{
          ToAddresses: [sender['email']],
          BccAddresses:[config['ses_from']]
        },
        Message:{
          Subject: {
            Data: 'Problema na validação de usuários'
          },
          Body: {
            Html: {
              Data: template
            }
          }
        }
      };

      ses.sendEmail(params, function(err, data){
        if(err){
          next(err);
        } else{
          console.log('Email sent: ', data);
        }

      });
    });
}

//MAIN

exports.handler = function(event, context) {
  //var arrayUsers= $('tr').each(function(){console.log($(this).find('td:eq(0)').text());console.log($(this).find('td:eq(1)').text());console.log($(this).find('td:eq(5)').html());});
  //console.log(arrayUsers);

  // tente validar usuário na clicksign
  if (event.type == "valide") {
    if (event.id == null) {
      context.succeed("sem ID");
    } else {
      console.log(event.id);
      var username = config['clicksign_auth_user'],
        password = config['clicksign_auth_pass'],
        url = 'https://' + username + ':' + password + "@desk.clicksign.com/admin/users/" + event.id + "/verify";
      request.post(url, {
        form: {
          _method: "patch"
        }
      });
      console.log("verificado");
      dynamo.update({
        TableName: 'Users',
        Key: {
          User_ID: parseInt(event.id)
        },
        UpdateExpression: 'set  #error=:tError',
        ExpressionAttributeNames: {
          '#error': 'erro_resposta'
        },
        ExpressionAttributeValues: {
          ':tError': 'verificado'
        }
      }, function(err, data) {
        if (err) {
          console.log(err);
          next(err);
        }
      })
    }
  } else if (event.type == "web") {
    async.waterfall([
      pegarLista,
      montarHtml
    ], function(err, html) {
      context.succeed(html)
    });
  } else {
    if (event.user_id == null) {
      async.waterfall([
          getFirstItem
        ],
        function(err, result) {
          process_stream(1, result);
        }
      );
      console.log('Received event:', JSON.stringify(event, null, 2));
    }

    // tente validar usuários, usado com a resposta da mensagem do aplicativo da receita 
    if (event.user_id != null) {
      if (event.type == "validar") {
        async.waterfall([
          async.apply(pegarPorID, event),
          validarCPF,
          //sendSlackMessage
        ]);
      } else if (event.type == "update") {
        async.waterfall([
          async.apply(pegarPorID, event),
          //updateSlackMessage
        ]);
      }
    };
  }
};
