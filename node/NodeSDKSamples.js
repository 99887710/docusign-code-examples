const express = require('express')
    , passport = require('passport')
    , session = require('express-session')
    , docusign = require('docusign-esign')
    , moment = require('moment')
    , fs = require('fs')
    , path = require('path')
    , {promisify} = require('util') // http://2ality.com/2017/05/util-promisify.html
    ;

const app = express()
    , port = process.env.PORT || 3000
    , host = process.env.HOST || 'localhost'
    , hostUrl = 'http://' + host + ':' + port
    , clientID = process.env.DS_CLIENT_ID || '{CLIENT_ID}'
    , clientSecret = process.env.DS_CLIENT_SECRET || '{CLIENT_SECRET}'
    , signerEmail = process.env.DS_SIGNER_EMAIL || '{USER_EMAIL}'
    , signerName = process.env.DS_SIGNER_NAME || '{USER_NAME}'
    , baseUriSuffix = '/restapi'
    , testDocumentPath = '../demo_documents/test.pdf'
    ;

let apiClient // The DocuSign API object
  , accountId // The DocuSign account that will be used
  , baseUri // the DocuSign platform base uri for the account.
  , sentEnvelopeId = false // envelopeId of the last envelope sent
  , eg // The example that's been requested
  ;

app.use(session({
  secret: 'secret token',
  resave: true,
  saveUninitialized: true
}));
app.use(passport.initialize());
app.use(passport.session());

// Configure Passport
passport.use(new docusign.OAuthClient({
    sandbox: true,
    clientID: clientID,
    clientSecret: clientSecret,
    callbackURL: hostUrl + '/auth/callback',
    state: true // automatic CSRF protection.
    // See https://github.com/jaredhanson/passport-oauth2/blob/master/lib/state/session.js
  },
  function (accessToken, refreshToken, params, user, done) {
    // The params arg will be passed additional parameters of the grant.
    // See https://github.com/jaredhanson/passport-oauth2/pull/84
    //
    // Here we're just assigning the tokens to the user profile object but we
    // could be using session storage or any other form of transient-ish storage
    user.accessToken = accessToken;
    user.refreshToken = refreshToken;
    user.expiresIn = params.expires_in;
    return done(null, user);
  }
));

// Passport session setup.
//   To support persistent login sessions, Passport needs to be able to
//   serialize users into and deserialize users out of the session.  Typically,
//   this will be as simple as storing the user ID when serializing, and finding
//   the user by ID when deserializing.  However, since this example does not
//   have a database of user records, the complete GitHub profile is serialized
//   and deserialized.
passport.serializeUser(function(user, done) {done(null, user)});
passport.deserializeUser(function(obj, done) {done(null, obj)});

app.get('/', function (req, res) {
  res.send(`<h2>Home page</h2>
<h3><a href="/auth?eg=1">Authenticate then Send Envelope via email</a></h3>
<h3><a href="/auth?eg=2">Authenticate then Embeddded Signing Ceremony</a></h3>
<h3><a href="/auth?eg=3">Authenticate then Send envelope using a template</a></h3>
<h3><a href="/auth?eg=4">Authenticate then Embedded Sending</a></h3>
<h3><a href="/auth?eg=5">Authenticate then Embedded DocuSign console</a></h3>
<h3><a href="/auth?eg=6">Authenticate then List multiple envelopes' status</a></h3>
<h3><a href="/auth?eg=7">Authenticate then Get an envelope's status</a></h3>
<h3><a href="/auth?eg=8">Authenticate then List an envelope's recipients</a></h3>
<h3><a href="/auth?eg=9">Authenticate then Download an envelope's document(s)</a></h3>
`)});

app.get('/auth', function (req, res, next) {
  req.session.eg = req.query.eg || 1; // Save the requested example number
  passport.authenticate('docusign')(req, res, next);
});

app.get('/auth/callback', [dsLoginCB1, dsLoginCB2]);

if (clientID === '{CLIENT_ID}') {
  console.log(`PROBLEM: You need to set the Client_ID (Integrator Key), and perhaps other settings as well. You can set them in the source or set environment variables.`);
} else {
  app.listen(port, host, function (err) {
    if (err) {
      throw err;
    }
    console.log(`Ready! Open ${hostUrl}`);
  });
}

function dsLoginCB1 (req, res, next) {
  passport.authenticate('docusign', { failureRedirect: '/auth' })(req, res, next)
}

function dsLoginCB2 (req, res, next) {
  // getting the API client ready
  apiClient = new docusign.ApiClient();
  console.log(`Received access_token: ${req.user.accessToken.substring(0,15)}...`);
  let expires = moment().add(req.user.expiresIn, 's');
  console.log(`Expires at ${expires.format("dddd, MMMM Do YYYY, h:mm:ss a")}`);
  apiClient.addDefaultHeader('Authorization', 'Bearer ' + req.user.accessToken);

  // The DocuSign Passport strategy looks up the user's account information via OAuth::userInfo.
  // See https://developers.docusign.com/esign-rest-api/guides/authentication/user-info-endpoints
  // We want the user's account_id, account_name, and base_uri
  // A user can (and often) belongs to multiple accounts.
  // You can search for a specific account the user has, or
  // give the user the choice of account to use, or use
  // the user's default account. This example used the default account.
  //
  // The baseUri changes rarely so it can (and should) be cached.
  //
  // req.user holds the result of DocuSign OAuth::userInfo and tokens.
  getDefaultAccountInfo(req.user.accounts)
  apiClient.setBasePath(baseUri); // baseUri is specific to the account
  docusign.Configuration.default.setDefaultApiClient(apiClient);
  // Execute an example.
  eg = req.session.eg; // retrieve the requested example number

  // Send an envelope via email
  let p1 = new Promise((resolve) => {
    if (eg == 1) {resolve(createEnvelope(accountId))
    } else {resolve(false)}
  })

  p1 // Kick off the promise chain

  // Embedded signing example (create Recipient View)
  .then ((result) => eg == 2 ? embeddedSigning(accountId) : result)

  // create a new envelope from template
  .then ((result) => eg == 3 ? createEnvelopeFromTemplate(accountId) : result)

  // Embedded sending example (create Sender View)
  .then ((result) => eg == 4 ? embeddedSending(accountId) : result)

  // Embedded DocuSign Console view (create Console view)
  .then ((result) => eg == 5 ? createConsoleView(accountId) : result)

  // get multiple envelope statuses (polling)
  .then ((result) => eg == 6 ? getMultipleEnvelopeStatuses(accountId) : result)

  // get an envelope's status (polling)
  .then ((result) => eg == 7 ? getEnvelopeStatus(accountId) : result)

  // list envelope recipients (polling)
  .then ((result) => eg == 8 ? listEnvelopeRecipients(accountId) : result)

  // download all envelope documents
  .then ((result) => eg == 9 ? downloadEnvelopeDocuments(accountId) : result)

  // handle the example's result
  .then ((result) => {
    let prefix = "<h2>Results:</h2><p>"
      , suffix = '</p><h2><a href="/">Continue</a></h2';
    if (result.redirect) {
      res.redirect(result.redirect)
    } else {
      res.send( `${prefix} ${result.msg} ${suffix}` );
    }
    next();
  })
}

/**
 * Set the variables accountId and baseUri from the default
 * account information.
 * @param {array} accounts Array of account information returned by
 *        OAuth::userInfo
 */
function getDefaultAccountInfo(accounts){
  let defaultAccount = accounts.find ((item) => item.is_default);
  console.log (`Default account "${defaultAccount.account_name}" (${defaultAccount.account_id})`);
  accountId = defaultAccount.account_id;
  baseUri =  `${defaultAccount.base_uri}${baseUriSuffix}`
}

/**
 * Return a promise version of an SDK method.
 * @param {object} obj a DocSign SDK object. Eg obj = new docusign.EnvelopesApi()
 * @param {string} method_name The string name of a method. Eg createEnvelope
 */
function make_promise(obj, method_name){
  let promise_name = method_name + '_promise';
  if (!(promise_name in obj)) {
    obj[promise_name] = promisify(obj[method_name]).bind(obj)
  }
  return obj[promise_name]
}


/////////////////////////////////////////////////////////////////////////////////

/**
 * Send an envelope (signing request) to one signer via email.
 * The file "test.pdf" will be used, with a Sign Here field
 * postioned via anchor text.
 * @param {string} accountId The accountId to be used.
 */
function createEnvelope(accountId) {
  // Create a byte array that will hold our document bytes
  let fileBytes;
  try {
    // read document file
    fileBytes = fs.readFileSync(path.resolve(__dirname, testDocumentPath));
  } catch (ex) {
    // handle error
    console.log('Exception while reading file: ' + ex);
  }

  // Create an envelope that will store the document(s), field(s), and recipient(s)
  let envDef = new docusign.EnvelopeDefinition();
  envDef.emailSubject = 'Please sign this document sent from Node SDK';

  // Add a document to the envelope.
  // This code uses a generic constructor:
  let doc = new docusign.Document()
    , base64Doc = Buffer.from(fileBytes).toString('base64');
  doc.documentBase64 = base64Doc;
  doc.name = 'TestFile.pdf'; // can be different from actual file name
  doc.extension = 'pdf';
  doc.documentId = '1';
  // Add to the envelope. Envelopes can have multiple docs, so an array is used
  envDef.documents = [doc];

  // Add a recipient to sign the document, identified by name and email
  // Objects for the SDK can be constructed from an object:
  let signer = docusign.Signer.constructFromObject(
    {email: signerEmail, name: signerName, recipientId: '1', routingOrder: '1'});

  // The test.pdf document includes an "anchor string" of "/sn1/" in
  // white text in the document. So we create a Sign Here
  // field in the document anchored at the string's location.
  // The offset is used to position the field correctly in the
  // document.
  let signHere = docusign.SignHere.constructFromObject({
    anchorString: '/sn1/',
    anchorYOffset: '10', anchorUnits: 'pixels',
    anchorXOffset: '20'})

  // A signer can have multiple tabs, so an array is used
  let signHereTabs = [signHere]
    , tabs = docusign.Tabs.constructFromObject({
              signHereTabs: signHereTabs});
  signer.tabs = tabs;

  // Add recipients (in this case a single signer) to the envelope
  envDef.recipients = new docusign.Recipients();
  envDef.recipients.signers = [signer];

  // Send the envelope by setting |status| to "sent". To save as a draft set to "created"
  envDef.status = 'sent';

  // instantiate a new EnvelopesApi object
  var envelopesApi = new docusign.EnvelopesApi();

  // call the createEnvelope() API to create and send the envelope
  // The createEnvelope() API is async and uses a callback
  // Promises are more convenient, so we promisfy it.
  let createEnvelope_promise = make_promise(envelopesApi, 'createEnvelope');
  return (
    createEnvelope_promise(accountId, {'envelopeDefinition': envDef})
    .then ((result) => {
      let msg = `\nCreated the envelope! Result: ${JSON.stringify(result)}`
      console.log(msg);
      return {msg: msg};
    })
    .catch ((err) => {
      // If the error is from DocuSign, the actual error body is available in err.response.body
      let errMsg = err.response && err.response.body && JSON.stringify(err.response.body)
        , msg = `\nException while creating the envelope! Result: ${err}`;
      if (errMsg) {
        msg += `. API error message: ${errMsg}`;
      }
      console.log(msg);
      return {msg: msg};
    })
  )
}

/////////////////////////////////////////////////////////////////////////////////
function createEnvelopeFromTemplate (accountId) {
  // create a new envelope object that we will manage the signature request through
  var envDef = new docusign.EnvelopeDefinition();
  envDef.emailSubject = 'Please sign this document sent from Node SDK';
  envDef.templateId = '{TEMPLATE_ID}';

  // create a template role with a valid templateId and roleName and assign signer info
  var tRole = new docusign.TemplateRole();
  tRole.roleName = '{ROLE}';
  tRole.name = '{USER_NAME}';
  tRole.email = '{USER_EMAIL}';

  // create a list of template roles and add our newly created role
  var templateRolesList = [];
  templateRolesList.push(tRole);

  // assign template role(s) to the envelope
  envDef.templateRoles = templateRolesList;

  // send the envelope by setting |status| to 'sent'. To save as a draft set to 'created'
  envDef.status = 'sent';

  // use the |accountId| we retrieved through the Login API to create the Envelope
  var accountId = accountId;

  // instantiate a new EnvelopesApi object
  var envelopesApi = new docusign.EnvelopesApi();

  // The createEnvelope() API is async and uses a callback
  // Promises are more convenient, so we promisfy it.
  let prom = make_promise(envelopesApi, 'createEnvelope');
  return (
    prom(accountId, {'envelopeDefinition': envDef})
    .then ((result) => {
      let msg = `Created the envelope! Result: ${JSON.stringify(result)}`
      console.log(msg);
      return msg;
    })
    .catch ((err) => {
      let msg = `Exception while creating the envelope! Result: ${err}}`
      console.log(msg);
      return msg;
    })
  )
}

/////////////////////////////////////////////////////////////////////////////////


/**
 * 1. Send an envelope (signing request) to one signer marked for
 * embedded signing (set the clientUserId parameter).
 * The file "test.pdf" will be used, with a Sign Here field
 * postioned via anchor text.
 * <br>
 * 2. Call getRecipientView and then redirect to the url
 * to initiate an embedded signing ceremony.
 * @param {string} accountId The accountId to be used.
 */
function embeddedSigning(accountId) {
  // Step 1, create the envelope is the same as for the createEnvelope
  // method except that the clientUserId parameter is set.
  // Create a byte array that will hold our document bytes
  let fileBytes;
  try {
    // read document file
    fileBytes = fs.readFileSync(path.resolve(__dirname, testDocumentPath));
  } catch (ex) {
    // handle error
    console.log('Exception while reading file: ' + ex);
  }

  // Create an envelope that will store the document(s), field(s), and recipient(s)
  let envDef = new docusign.EnvelopeDefinition();
  envDef.emailSubject = 'Please sign this document sent from Node SDK';

  // Add a document to the envelope.
  // This code uses a generic constructor:
  let doc = new docusign.Document()
    , base64Doc = Buffer.from(fileBytes).toString('base64');
  doc.documentBase64 = base64Doc;
  doc.name = 'TestFile.pdf'; // can be different from actual file name
  doc.extension = 'pdf';
  doc.documentId = '1';
  // Add to the envelope. Envelopes can have multiple docs, so an array is used
  envDef.documents = [doc];

  // Add a recipient to sign the document, identified by name and email
  // Objects for the SDK can be constructed from an object:
  let signer = docusign.Signer.constructFromObject(
    {email: signerEmail, name: signerName, recipientId: '1', routingOrder: '1'});

  //*** important: must set the clientUserId property to embed the recipient!
  // Otherwise the DocuSign platform will treat recipient as remote (an email
  // will be sent) and the embedded signing will not work.
  let clientUserId = '1001'
  signer.clientUserId = clientUserId;

  // The test.pdf document includes an "anchor string" of "/sn1/" in
  // white text in the document. So we create a Sign Here
  // field in the document anchored at the string's location.
  // The offset is used to position the field correctly in the
  // document.
  let signHere = docusign.SignHere.constructFromObject({
    anchorString: '/sn1/',
    anchorYOffset: '10', anchorUnits: 'pixels',
    anchorXOffset: '20'})

  // A signer can have multiple tabs, so an array is used
  let signHereTabs = [signHere]
    , tabs = docusign.Tabs.constructFromObject({
              signHereTabs: signHereTabs});
  signer.tabs = tabs;

  // Add recipients (in this case a single signer) to the envelope
  envDef.recipients = new docusign.Recipients();
  envDef.recipients.signers = [signer];

  // Send the envelope by setting |status| to "sent". To save as a draft set to "created"
  envDef.status = 'sent';

  // instantiate a new EnvelopesApi object
  var envelopesApi = new docusign.EnvelopesApi();

  // call the createEnvelope() API to create and send the envelope
  // The createEnvelope() API is async and uses a callback
  // Promises are more convenient, so we promisfy it.
  let createEnvelope_promise = make_promise(envelopesApi, 'createEnvelope');
  return (
    createEnvelope_promise(accountId, {'envelopeDefinition': envDef})
    .then ((result) => {
      let msg = `\nCreated the envelope! Result: ${JSON.stringify(result)}`
      console.log(msg);
      return result.envelopeId;
    })
    .then ((envelopeId) =>
      // Step 2 call createRecipientView() to generate the signing URL!
      createRecipientView(accountId, envelopeId, clientUserId)
    )
    .catch ((err) => {
      // If the error is from DocuSign, the actual error body is available in err.response.body
      let errMsg = err.response && err.response.body && JSON.stringify(err.response.body)
        , msg = `\nException! Result: ${err}`;
      if (errMsg) {
        msg += `. API error message: ${errMsg}`;
      }
      console.log(msg);
      return {msg: msg};
    })
  )
}

/**
 * Step 2. Call getRecipientView and then redirect to the url
 * to initiate an embedded signing ceremony.
 * @param {string} accountId The accountId to be used.
 * @param {string} envelopeId The envelope's id.
 * @param {string} clientUserId The value used when the signer was added to the envelope.
 */
function createRecipientView(accountId, envelopeId, clientUserId) {
  // instantiate a new EnvelopesApi object
  let envelopesApi = new docusign.EnvelopesApi();

  // set the url where you want the recipient to go once they are done signing
  // should typically be a callback route somewhere in your app
  let viewRequest = new docusign.RecipientViewRequest();
  viewRequest.returnUrl = hostUrl;
  // How has your app authenticated the user? In addition to your app's
  // authentication, you can include authenticate steps from DocuSign.
  // Eg, SMS authentication
  viewRequest.authenticationMethod = 'none';
  // recipient information must match embedded recipient info
  // we used to create the envelope.
  viewRequest.email = signerEmail;
  viewRequest.userName = signerName;
  viewRequest.clientUserId = clientUserId;

  // call the CreateRecipientView API
  let createRecipientView_promise = make_promise(envelopesApi, 'createRecipientView');
  return (
    createRecipientView_promise(accountId, envelopeId,
      {recipientViewRequest: viewRequest})
    .then ((result) => {
      let msg = `\nCreated the recipientView! Result: ${JSON.stringify(result)}`
      console.log(msg);
      return {redirect: result.url};
    })
  )
}

/////////////////////////////////////////////////////////////////////////////////

/**
 * 1. Create a draft envelope (signing request) for one signer.
 * The file "test.pdf" will be used, with a Sign Here field
 * absolutely positioned
 * <br>
 * 2. Call getSenderView and then redirect to the url
 * to initiate an embedded sending ceremony.
 * @param {string} accountId The accountId to be used.
 */
function embeddedSending(accountId) {
  // Create a byte array that will hold our document bytes
  let fileBytes;
  try {
    // read document file
    fileBytes = fs.readFileSync(path.resolve(__dirname, testDocumentPath));
  } catch (ex) {
    // handle error
    console.log('Exception while reading file: ' + ex);
  }

  // Create an envelope that will store the document(s), field(s), and recipient(s)
  let envDef = new docusign.EnvelopeDefinition();
  envDef.emailSubject = 'Please sign this document sent from Node SDK';

  // Add a document to the envelope.
  // This code uses a generic constructor:
  let doc = new docusign.Document()
    , base64Doc = Buffer.from(fileBytes).toString('base64');
  doc.documentBase64 = base64Doc;
  doc.name = 'TestFile.pdf'; // can be different from actual file name
  doc.extension = 'pdf';
  doc.documentId = '1';
  // Add to the envelope. Envelopes can have multiple docs, so an array is used
  envDef.documents = [doc];

  // Add a recipient to sign the document, identified by name and email
  // Objects for the SDK can be constructed from an object:
  let signer = docusign.Signer.constructFromObject(
    {email: signerEmail, name: signerName, recipientId: '1', routingOrder: '1'});

  // create a signHere tab 100 pixels down and 150 right from the top left
  // corner of first page of document
  let signHere = new docusign.SignHere();
  signHere.documentId = '1';
  signHere.pageNumber = '1';
  signHere.recipientId = '1';
  signHere.xPosition = '100';
  signHere.yPosition = '150';

  // A signer can have multiple tabs, so an array is used
  let signHereTabs = [signHere]
    , tabs = docusign.Tabs.constructFromObject({
              signHereTabs: signHereTabs});
  signer.tabs = tabs;

  // Add recipients (in this case a single signer) to the envelope
  envDef.recipients = new docusign.Recipients();
  envDef.recipients.signers = [signer];

  // Create a draft envelope by setting |status| to "created"
  envDef.status = 'created';

  // instantiate a new EnvelopesApi object
  let envelopesApi = new docusign.EnvelopesApi();

  // call the createEnvelope() API to create and send the envelope
  // The createEnvelope() API is async and uses a callback
  // Promises are more convenient, so we promisfy it.
  let createEnvelope_promise = make_promise(envelopesApi, 'createEnvelope');
  return (
    createEnvelope_promise(accountId, {'envelopeDefinition': envDef})
    .then ((result) => {
      let msg = `\nCreated the draft envelope! Result: ${JSON.stringify(result)}`
      console.log(msg);
      return result.envelopeId;
    })
    .then ((envelopeId) =>
      // Step 2 call createSenderView() to generate the signing URL!
      createSenderView(accountId, envelopeId)
    )
    .catch ((err) => {
      // If the error is from DocuSign, the actual error body is available in err.response.body
      let errMsg = err.response && err.response.body && JSON.stringify(err.response.body)
        , msg = `\nException! Result: ${err}`;
      if (errMsg) {
        msg += `. API error message: ${errMsg}`;
      }
      console.log(msg);
      return {msg: msg};
    })
  )
}

/////////////////////////////////////////////////////////////////////////////////

/**
 * Step 2. Call getSenderView and then redirect to the url
 * to initiate an embedded sending for the envelope.
 * The sender's view can be started either in the
 * sender (recipients and documents) screen or the tagging
 * screen of the sender web tool.
 * @param {string} accountId The accountId to be used.
 * @param {string} envelopeId The envelope's id.
 */
function createSenderView(accountId, envelopeId) {
  let startWithRecipientsScreen = true;

  // instantiate a new EnvelopesApi object
  let envelopesApi = new docusign.EnvelopesApi();

  // set the url where you want the recipient to go once they are done signing
  // should typically be a callback route somewhere in your app
  let viewRequest = new docusign.ReturnUrlRequest();
  viewRequest.returnUrl = hostUrl;

  // call the CreateRecipientView API
  let createSenderView_promise = make_promise(envelopesApi, 'createSenderView');
  return (
    createSenderView_promise(accountId, envelopeId, {returnUrlRequest: viewRequest})
    .then ((result) => {
      let msg = `\nCreated the senderView! Result: ${JSON.stringify(result)}
Start with the recipient's screen: ${startWithRecipientsScreen}`
      console.log(msg);
      let url = result.url;
      if (startWithRecipientsScreen) {
        url = url.replace('send=1', 'send=0');
      }
      return {redirect: url};
    })
  )
}

/////////////////////////////////////////////////////////////////////////////////

/**
 * Open the console view of NDSE for the user.
 * @param {string} accountId The accountId to be used.
 */
function createConsoleView(accountId) {
  // instantiate a new EnvelopesApi and consoleViewRequest objects
  let envelopesApi = new docusign.EnvelopesApi()
    , viewRequest = new docusign.ConsoleViewRequest();
  viewRequest.returnUrl = hostUrl;

  // call the CreateConsoleView API
  let createConsoleView_promise = make_promise(envelopesApi, 'createConsoleView');
  return (
    createConsoleView_promise(accountId, {'consoleViewRequest': viewRequest})
    .then ((result) => {
      let msg = `\nCreated the ConsoleView! Result: ${JSON.stringify(result)}`
      console.log(msg);
      return {redirect: result.url};
    })
    .catch ((err) => {
      // If the error is from DocuSign, the actual error body is available in err.response.body
      let errMsg = err.response && err.response.body && JSON.stringify(err.response.body)
        , msg = `\nException! Result: ${err}`;
      if (errMsg) {
        msg += `. API error message: ${errMsg}`;
      }
      console.log(msg);
      return {msg: msg};
    })
  )
}

/////////////////////////////////////////////////////////////////////////////////
function getMultipleEnvelopeStatuses(accountId) {

  // instantiate a new EnvelopesApi
  var envelopesApi = new docusign.EnvelopesApi();

  // the list status changes call requires at least a from_date OR
  // a set of envelopeIds. here we filter using a from_date
  var options = {};

  // set from date to filter envelopes (ex: Jan 15, 2018)
  options.fromDate = '2018/15/01';

  // call the listStatusChanges() API
  envelopesApi.listStatusChanges(accountId, options, function (error, envelopes, response) {
    if (error) {
      console.log('Error: ' + error);
      return;
    }

    if (envelopes) {
      console.log('EnvelopesInformation: ' + JSON.stringify(envelopes));
    }
  });
}

/////////////////////////////////////////////////////////////////////////////////
function getEnvelopeStatus(accountId, envelopeId) {

  // instantiate a new EnvelopesApi object
  var envelopesApi = new docusign.EnvelopesApi();

  // call the getEnvelope() API
  envelopesApi.getEnvelope(accountId, envelopeId, null, function (error, env, response) {
    if (error) {
      console.log('Error: ' + error);
      return;
    }

    if (env) {
      console.log('Envelope: ' + JSON.stringify(env));
    }
    return env;
  });
}
/////////////////////////////////////////////////////////////////////////////////
function listEnvelopeRecipients(accountId, envelopeId) {

  // instantiate a new EnvelopesApi object
  var envelopesApi = new docusign.EnvelopesApi();

  // call the listRecipients() API
  envelopesApi.listRecipients(accountId, envelopeId, null, function (error, recips, response) {
    if (error) {
      console.log('Error: ' + error);
      return;
    }
    if (recips) {
      console.log('Recipients: ' + JSON.stringify(recips));
    }
    return recips;
  });
}
/////////////////////////////////////////////////////////////////////////////////
function downloadEnvelopeDocuments(accountId, envelopeId) {

  // API workflow contains two API requests:
  // 1) list envelope documents API
  // 2) get document API (for each doc)

  // instantiate a new EnvelopesApi object
  var envelopesApi = new docusign.EnvelopesApi();

  // call the listDocuments() API
  envelopesApi.listDocuments(accountId, envelopeId, null, function (error, docsList, response) {
    if (error) {
      console.log('Error: ' + error);
      return;
    }
    if (docsList) {
      console.log('Envelope Documents: ' + JSON.stringify(docsList));

      // instantiate a new EnvelopesApi object
      var envelopesApi = new docusign.EnvelopesApi();

      // **********************************************************
      // Loop through the envelope documents and download each one.
      // **********************************************************
      for (var i = 0; i < docsList.envelopeDocuments.length; i++) {
        var documentId = docsList.envelopeDocuments[i].documentId;
        // call the getDocument() API
        envelopesApi.getDocument(accountId, envelopeId, documentId, null, function (error, document, response) {
          if (error) {
            console.log('Error: ' + error);
            return;
          }
          if (document) {
            try {
              var fs = require('fs');
              var path = require('path');
              // download the document pdf
              var filename = envelopeId + '_' + documentId + '.pdf';
              var tempFile = path.resolve(__dirname, filename);
              fs.writeFile(tempFile, new Buffer(document, 'binary'), function (err) {
                if (err) console.log('Error: ' + err);
              });
              console.log('Document ' + documentId + ' from envelope ' + envelopeId + ' has been downloaded to:\n' + tempFile);
            } catch (ex) {
              console.log('Exception: ' + ex);
            }
          }
        });
      }
    }
  });
}
