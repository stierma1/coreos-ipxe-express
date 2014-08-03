#!/usr/bin/env node

var Promise = require('bluebird');
var fs = Promise.promisifyAll(require('fs'));

var path = require('path');
var express = require('express');
var app = express();

var env = {
  baseUrl : process.env.COREOS_IPXE_SERVER_BASE_URL ? process.env.COREOS_IPXE_SERVER_BASE_URL : '',
  dataDirectory : process.env.COREOS_IPXE_SERVER_DATA_DIR ? process.env.COREOS_IPXE_SERVER_DATA_DIR : "/opt/coreos-ipxe-server",
  listenPort : process.env.COREOS_IPXE_SERVER_LISTEN_ADDR ? process.env.COREOS_IPXE_SERVER_LISTEN_ADDR : "4777"
}

var script = '#!ipxe\r\n' +
'set coreos-version {{.Version}}\r\n' +
'set base-url http://{{.BaseUrl}}/images/amd64-usr/${coreos-version}\r\n' +
'kernel ${base-url}/coreos_production_pxe.vmlinuz{{.Options}}\r\n' +
'initrd ${base-url}/coreos_production_pxe_image.cpio.gz\r\n' +
'boot\r\n';

var cloudConfigBase = path.join(env.dataDirectory,'/configs');

app.get('/', getScript);

app.use('/configs', express.static(path.join(env.dataDirectory,'/configs')));
app.use('/images', express.static(path.join(env.dataDirectory,'/images')));
app.use('/sshKeys', express.static(path.join(env.dataDirectory,'/sshKeys')));

app.listen(env.listenPort.split(':')[1]);

console.log('Listening on ' + env.listenPort)

function getScript(req, res){
  var profileId = req.query['profile'] || '';
  if(env.baseUrl === ''){
    env.baseUrl = req.hostname;
  }
  console.log('Request for profile ' + profileId)
  getProfile(profileId)
    .then(JSON.parse)
    .then(getOptions)
    .then(processScript)
    .then(function(genScript){
      res.header('Content-Type', 'text/plain');
      res.status(200).send(genScript);
    }).catch(function(err){
      res.status(500).send(err);
    })
}

function getProfile(profileId){
  if(profileId === ''){
    return Promise.resolve('{}');
  }
  var profilePath = path.join(env.dataDirectory, 'profiles', profileId + '.json');
  return fs.readFileAsync(profilePath, 'utf8');
}

function getOptions(profile){
  var options = {
    'cloud_config' : '',
    'console' : [],
    'coreos_autologin' : '',
    'root' : '',
    'rootfstype' : '',
    'sshkey' : '',
    'version' : '',
    toString : function(){
      var optString = "";
      optString += this.rootfstype ? (' rootfstype=' + this.rootfstype) : '';
      for(var i in this.console){
        optString += ' console=' + this.console[i];
      }
      optString += this.cloud_config ? (' cloud-config-url=http://' + env.baseUrl + '/configs/' + this.cloud_config + '.yml') : '';
      optString += this.coreos_autologin ? (' coreos.autologin=' + this.coreos_autologin): '';
      optString += this.sshkey ? (' sshkey="' + fs.readFileSync(path.join(env.dataDirectory, 'sshKeys', this.sshkey + '.pub'), 'utf8')).trim() + '"' : '';
      optString += this.root ? (' root=' + this.root) : '';

      return optString;
    }
  };
  options.toString = options.toString.bind(options)

  for(var i in options){
    for(var j in profile){
      if(i === j){
        options[i] = profile[j];
      }
    }
  }

  return options;
}

function processScript(options){
  var scriptVariables = {
    '{{.Version}}' :'',
    '{{.BaseUrl}}' : '',
    '{{.Options}}' : ''
  };

  scriptVariables['{{.Version}}'] = options.version;
  scriptVariables['{{.BaseUrl}}'] = env.baseUrl;
  scriptVariables['{{.Options}}'] = options.toString();
  var genScript = script + '';
  for(var i in scriptVariables){
    genScript = genScript.replace(i, scriptVariables[i]);
  }

  return genScript;
}
