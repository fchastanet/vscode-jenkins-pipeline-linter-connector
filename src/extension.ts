'use strict';

import * as vscode from 'vscode';
import axios from 'axios';
import * as https from 'https';
import * as qs from 'qs';
import OpenAI from 'openai';

async function requestWithCrumb(url: string, crumbUrl: string, user: string|undefined, pass: string|undefined, token: string|undefined, strictSsl: boolean, output: vscode.OutputChannel) {
    let options: any = {
        method: 'get',
        url: crumbUrl,
        headers: {}
    };

    if (user !== undefined && user.length > 0) {
        if(pass !== undefined && pass.length > 0) {
            let authToken = Buffer.from(user + ':' + pass).toString('base64');
            options.headers = Object.assign(options.headers, { Authorization: 'Basic ' + authToken });
        } else if ( token !== undefined && token.length > 0) {
            let authToken = Buffer.from(user + ':' + token).toString('base64');
            options.headers = Object.assign(options.headers, { Authorization: 'Basic ' + authToken });
        }
    }
    
    if (!strictSsl) {
        // Create custom HTTPS agent that ignores SSL certificate errors
        const httpsAgent = new https.Agent({
            rejectUnauthorized: false
        });
        options['httpsAgent'] = httpsAgent;
    }

    console.log("=========== crumb options ==========>")
    console.log(options)
    console.log("=========== crumb options <==========")

    axios(options)
    .then((response: any) => {
        console.log(response)
        validateRequest(url, user, pass, token, response.data, output, strictSsl);
    })
    .catch((err: any) => {
        console.log(err)
        output.appendLine(err);
    });
}

async function validateRequest(url: string, user: string|undefined, pass: string|undefined, token: string|undefined, crumb: string|undefined, output: vscode.OutputChannel, strictSsl: boolean = true) {
    output.clear();
    let activeTextEditor = vscode.window.activeTextEditor;
    if (activeTextEditor !== undefined) {
        let checkExts = vscode.workspace.getConfiguration().get('jenkins.pipeline.linter.checkextensions') as string[] | undefined;
        let path = activeTextEditor.document.fileName;

        console.log("========== Pipeline File ==========");
        console.log(path)
        console.log("========== Pipeline File ==========");
        if(checkExts == undefined) {
            return
        }
        let fileCanBeChecked = false;
        for (let i = 0; i < checkExts.length; i++) {
            if (path.indexOf(checkExts[i]) != -1) {
                fileCanBeChecked = true
            }
        }
        if (!fileCanBeChecked) {
            output.appendLine('File type not supported. Make sure the filename contains one of the following extensions: ' + checkExts.join(', ') + '.\n');
            output.appendLine('you can control what file can be checked through this configuration `jenkins.pipeline.linter.checkextensions`.');
            return;
        }

        let data = qs.stringify({ 
            'jenkinsfile': activeTextEditor.document.getText()
        });

        console.log("========== Pipeline Content ==========")
        console.log(data)
        console.log("========== Pipeline Content ==========")

        let options: any = {
            method: 'post',
            url: url,
            data : data,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            }
        };

        if(crumb !== undefined && crumb.length > 0) {
            let crumbSplit = crumb.split(':');
            options.headers = Object.assign(options.headers, {'Jenkins-Crumb': crumbSplit[1]});
        }

        if (user !== undefined && user.length > 0) {
            if(pass !== undefined && pass.length > 0) {
                let authToken = Buffer.from(user + ':' + pass).toString('base64');
                options.headers = Object.assign(options.headers, { Authorization: 'Basic ' + authToken });
            } else if ( token !== undefined && token.length > 0) {
                let authToken = Buffer.from(user + ':' + token).toString('base64');
                options.headers = Object.assign(options.headers, { Authorization: 'Basic ' + authToken });
            }
        } 

        console.log("======= start: Jenkinsfile validate options =======");
        console.log(options);
        console.log("=======  Jenkinsfile validate options :end  =======");
        
        // Add HTTPS agent for SSL certificate validation when strictSSL is false
        if (!vscode.workspace.getConfiguration().get('jenkins.pipeline.linter.connector.strictSsl')) {
            const httpsAgent = new https.Agent({
                rejectUnauthorized: false
            });
            options['httpsAgent'] = httpsAgent;
        }
        
        let jenkinsLinterResult = "";
        let llmSwitch = vscode.workspace.getConfiguration().get('jenkins.pipeline.linter.connector.llm.enable') as boolean | undefined;
        
        axios(options)
        .then((response: any) => {
            console.log(options);
            console.log(response.data);
            jenkinsLinterResult = response.data;
            output.appendLine("Jenkins Pipeline Linter Result:");
            output.appendLine(response.data);
            if(llmSwitch) {
                let respLangCode = vscode.workspace.getConfiguration().get('jenkins.pipeline.linter.connector.llm.respLangCode') as string;
                output.appendLine("Waiting for LLM Assistant Answer...");
                output.appendLine("Response Language Code: " + respLangCode);
            }
        })
        .catch((err: any) => {
            console.log(options);
            console.log(err);
            if (err.response) {
                // The server responded with a status code outside the 2xx range
                console.log(`Error ${err.response.status}: ${err.response.statusText}`);
                console.log(`Response data: ${JSON.stringify(err.response.data)}`);
            } else if (err.request) {
                // The request was made but no response was received
                console.log('No response received from server');
            } else {
                // Something happened in setting up the request
                console.log(`Error: ${err.message}`);
            }
            console.log(err);
        });

        
        if(llmSwitch) {
            const baseUrl = vscode.workspace.getConfiguration().get('jenkins.pipeline.linter.connector.llm.baseUrl') as string;
            let modelName = vscode.workspace.getConfiguration().get('jenkins.pipeline.linter.connector.llm.modelName') as string;
            let apiKey = vscode.workspace.getConfiguration().get('jenkins.pipeline.linter.connector.llm.apiKey') as string;
            let respLangCode = vscode.workspace.getConfiguration().get('jenkins.pipeline.linter.connector.llm.respLangCode') as string;

            const openai = new OpenAI({
                apiKey: apiKey,
                baseURL: baseUrl
            });

            const system_prompt = "You're the core developer of Jenkins open source software. You are familiar with the syntax of Jenkins declarative Pipeline. Jenkins Pipeline Linter can check the contents of the Jenkinsfile and indicate if there are any syntax errors. I will put the inspection results of Jenkins Pipeline Linter in {}. Please give professional review opinions based on the inspection results of Jenkins Pipeline Linter Linter and the content of Jenkinsfile wrapped in []. Always response with language " + respLangCode;
            
            try {
                const completion = await openai.chat.completions.create({
                    model: modelName,
                    messages: [
                        { role: "system", content: system_prompt },
                        { role: "user", content: "Jenkins Pipeline Linter validate result is {" + jenkinsLinterResult + "}, You should review Jenkinsfile content is: [" + activeTextEditor.document.getText() + "]. Please provide your code review feedback." }
                    ]
                });
                
                console.log(completion);
                if (completion.choices && completion.choices.length > 0) {
                    const content = completion.choices[0].message.content;
                    output.appendLine("LLM Assistant Answer: \n" + (content || "") + "\n");
                }
            } catch (error) {
                console.error("Error calling OpenAI API:", error);
                output.appendLine("Error calling LLM API. Check console for details.");
            }
        }
    } else {
        output.appendLine('No active text editor. Open the jenkinsfile you want to validate.');
    }
}

export function activate(context: vscode.ExtensionContext) {
    let output : vscode.OutputChannel = vscode.window.createOutputChannel("Jenkins Pipeline Linter");

    let lastInput: string;

    let validate = vscode.commands.registerCommand('jenkins.pipeline.linter.connector.validate', async () => {

        let url = vscode.workspace.getConfiguration().get('jenkins.pipeline.linter.connector.url') as string | undefined;
        let user = vscode.workspace.getConfiguration().get('jenkins.pipeline.linter.connector.user') as string | undefined;
        let pass = vscode.workspace.getConfiguration().get('jenkins.pipeline.linter.connector.pass') as string | undefined;
        let token = vscode.workspace.getConfiguration().get('jenkins.pipeline.linter.connector.token') as string | undefined;
        let crumbUrl = vscode.workspace.getConfiguration().get('jenkins.pipeline.linter.connector.crumbUrl') as string | undefined;
        let strictSsl = vscode.workspace.getConfiguration().get('jenkins.pipeline.linter.connector.strictSsl') as boolean | undefined;

        if (strictSsl === undefined) {
            strictSsl = true; // Default to true if not set
        }
        if (url === undefined || url.length === 0) {
            url = await vscode.window.showInputBox({ prompt: 'Enter Jenkins Pipeline Linter Url.', value: lastInput });
        }
        if ((user !== undefined && user.length > 0) && (pass === undefined || pass.length === 0) && (token === undefined || token.length === 0)) {
            pass = await vscode.window.showInputBox({ prompt: 'Enter password.', password: true });
            if(pass === undefined || pass.length === 0) {
                token = await vscode.window.showInputBox({ prompt: 'Enter token.', password: false });
            }
        }
        if (url !== undefined && url.length > 0) {
            lastInput = url;

            if(crumbUrl !== undefined && crumbUrl.length > 0) {
                requestWithCrumb(url, crumbUrl, user, pass, token, strictSsl, output);
            } else {
                validateRequest(url, user, pass, token, undefined, output, strictSsl);
            }
        } else {
            output.appendLine('Jenkins Pipeline Linter Url is not defined.');
        }
        output.show(true);
    });

    let onSave = vscode.workspace.onDidSaveTextDocument((_document: vscode.TextDocument) => {        
        let onSave = vscode.workspace.getConfiguration().get('jenkins.pipeline.linter.onsave') as boolean;
        console.log(`User onSave ${onSave}`)
        if (!onSave)
            return;

        vscode.commands.executeCommand('jenkins.pipeline.linter.connector.validate');
    });

    context.subscriptions.push(validate);
    context.subscriptions.push(onSave);
}

// this method is called when your extension is deactivated
export function deactivate() {
}
