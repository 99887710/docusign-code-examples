# DocuSign Node.js SDK Samples

Code examples for the DocuSign Node.js SDK. These examples demonstrate:
* Sending an Envelope via email
* Embeddded Signing Ceremony
* Sending an envelope using a template
* Embedded Sending tool
* Embedded DocuSign console
* List multiple envelopes' status
* Get an envelope's status
* List an envelope's recipients
* Download an envelope's document(s)

## Requirements
* The Node.JS examples require Node v8.10 or later.
  The Node.JS SDK can be used with earlier versions of Node.JS.
* npm v5 or later


## Installation
1. Clone or download this repository.
1. **cd docusign-code-examples/node**
1. **npm install**   (This step will install all needed libraries including the DocuSign Node.JS SDK.)
1. You will need an Integrator Key and a matching secret key.
   It must also be configured to accept `http://localhost:3000/auth/callback`
   as a **Redirect URI**
1. Open the `NodeSDKSamples.js` file in an editor and update the
   values for '{CLIENT_ID}', '{CLIENT_SECRET}', '{USER_EMAIL}', and '{USER_NAME}'.
   Remove the braces too.
1. A more secure approach: instead of modifying the source to include your
   secret information, environment variables can be used to hold the values.
   See the source file for the names of the environment variables.
1. (Optional) To run the example that sends an envelope using a template from the server,
   you must first create the template:
   * See the [Template documentation.](https://support.docusign.com/guides/ndse-user-guide-create-templates)
   * For the example, create a template with a role named **signer1**
   * [Look up the template id](https://support.docusign.com/en/guides/ndse-user-guide-locate-template-id)
   and then either add it to the source or use the `DS_TEMPLATE_ID`
   environment variable.

## Running the Node.JS examples

1. Execute **npm run** in a console/terminal window.
   The examples will send logging information to the console/terminal window.
2. Use your browser to open http://localhost:3000

### Debugging

1. **npm run-script debug**
1. Using the Chrome browser, open URL **chrome://inspect/#devices**
1. To open the Node debugger tool, click the page's link **Open dedicated DevTools for Node**

### SDK Repository

The DocuSign eSignature Node.JS SDK is open source and available from
[GitHub](https://github.com/docusign/docusign-node-client).
