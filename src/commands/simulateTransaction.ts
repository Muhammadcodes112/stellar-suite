import * as vscode from 'vscode';
import { SorobanCliService } from '../services/sorobanCliService';
import { RpcService } from '../services/rpcService';
import { ContractInspector, ContractFunction } from '../services/contractInspector';
import { WorkspaceDetector } from '../utils/workspaceDetector';
import { SimulationPanel } from '../ui/simulationPanel';
import { SidebarViewProvider } from '../ui/sidebarView';
import { parseFunctionArgs } from '../utils/jsonParser';
import { formatError } from '../utils/errorFormatter';
import { resolveCliConfigurationForCommand } from '../services/cliConfigurationVscode';
import { SimulationValidationService } from '../services/simulationValidationService';
import { ContractWorkspaceStateService } from '../services/contractWorkStateService';

export async function simulateTransaction(context: vscode.ExtensionContext, sidebarProvider?: SidebarViewProvider) {
    try {
        const resolvedCliConfig = await resolveCliConfigurationForCommand(context);
        if (!resolvedCliConfig.validation.valid) {
            vscode.window.showErrorMessage(
                `CLI configuration is invalid: ${resolvedCliConfig.validation.errors.join(' ')}`
            );
            return;
        }

        const useLocalCli = resolvedCliConfig.configuration.useLocalCli;
        const cliPath = resolvedCliConfig.configuration.cliPath;
        const source = resolvedCliConfig.configuration.source;
        const network = resolvedCliConfig.configuration.network;
        const rpcUrl = resolvedCliConfig.configuration.rpcUrl;
        
        const workspaceStateService = new ContractWorkspaceStateService(context, vscode.workspace);
        await workspaceStateService.initialize();
        const lastContractId = workspaceStateService.getLastContractId();

        let defaultContractId = lastContractId || '';
        try {
            if (!defaultContractId) {
                const detectedId = await WorkspaceDetector.findContractId();
                if (detectedId) {
                    defaultContractId = detectedId;
                }
            }
        } catch (error) {
        }

        const contractId = await vscode.window.showInputBox({
            prompt: 'Enter the contract ID (address)',
            placeHolder: defaultContractId || 'e.g., C...',
            value: defaultContractId,
            validateInput: (value: string) => {
                if (!value || value.trim().length === 0) {
                    return 'Contract ID is required';
                }
                // Basic validation for Stellar contract ID format
                if (!value.match(/^C[A-Z0-9]{55}$/)) {
                    return 'Invalid contract ID format (should start with C and be 56 characters)';
                }
        return null;
    }
});

if (contractId === undefined) {
    return; // User cancelled
}

await workspaceStateService.setLastContractId(contractId);

// Get the function name to call
const functionName = await vscode.window.showInputBox({
    prompt: 'Enter the function name to simulate',
    placeHolder: 'e.g., transfer'
});

if (functionName === undefined) {
    return; // User cancelled
}

// Get function info and parameters
const inspector = new ContractInspector(useLocalCli ? cliPath : rpcUrl, source);
const contractFunctions = await inspector.getContractFunctions(contractId);
const selectedFunction = contractFunctions.find(f => f.name === functionName);

let args: any[] = [];

if (selectedFunction && selectedFunction.inputs.length > 0) {
    // Show function parameters
    const paramInput = await vscode.window.showInputBox({
        prompt: `Enter arguments for ${functionName}(${selectedFunction.inputs.map(i => `${i.name}: ${i.type}`).join(', ')})`,
        placeHolder: 'e.g., {"name": "world"}'
    });

    if (paramInput === undefined) {
        return; // User cancelled
    }

    try {
        const parsed = JSON.parse(paramInput || '{}');
        if (typeof parsed === 'object' && !Array.isArray(parsed) && parsed !== null) {
            args = [parsed];
        } else {
            vscode.window.showErrorMessage('Arguments must be a JSON object');
            return;
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Invalid JSON: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return;
    }
} else {
    // No parameters or couldn't get function info - use manual input
            const argsInput = await vscode.window.showInputBox({
                prompt: 'Enter function arguments as JSON object (e.g., {"name": "value"})',
                placeHolder: 'e.g., {"name": "world"}',
                value: '{}'
            });

            if (argsInput === undefined) {
                return; // User cancelled
            }

            try {
                const parsed = JSON.parse(argsInput || '{}');
                if (typeof parsed === 'object' && !Array.isArray(parsed) && parsed !== null) {
                    args = [parsed];
                } else {
                    vscode.window.showErrorMessage('Arguments must be a JSON object');
                    return;
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Invalid JSON: ${error instanceof Error ? error.message : 'Unknown error'}`);
                return;
            }
        }

        // Validate simulation input and predict possible failures before execution
        const validationService = new SimulationValidationService();
        const validationReport = validationService.validateSimulation(
            contractId,
            functionName,
            args,
            selectedFunction,
            contractFunctions
        );

        const validationWarnings = [
            ...validationReport.warnings,
            ...validationReport.predictedErrors
                .filter(prediction => prediction.severity === 'warning')
                .map(prediction => `${prediction.code}: ${prediction.message}`),
        ];

        if (!validationReport.valid) {
            const validationErrorMessage = [
                ...validationReport.errors,
                ...(validationReport.suggestions.length > 0
                    ? ['Suggestions:', ...validationReport.suggestions.map(suggestion => `- ${suggestion}`)]
                    : []),
            ].join('\n');

            const panel = SimulationPanel.createOrShow(context);
            panel.updateResults(
                {
                    success: false,
                    error: `Simulation validation failed before execution.\n\n${validationErrorMessage}`,
                    errorSummary: validationReport.errors[0],
                    errorSuggestions: validationReport.suggestions,
                    validationWarnings,
                },
                contractId,
                functionName,
                args
            );

            vscode.window.showErrorMessage(`Simulation validation failed: ${validationReport.errors[0]}`);
            return;
        }

        if (validationWarnings.length > 0) {
            const firstWarning = validationWarnings[0];
            const selection = await vscode.window.showWarningMessage(
                `Simulation pre-check warning: ${firstWarning}`,
                'Continue',
                'Cancel'
            );

            if (selection !== 'Continue') {
                vscode.window.showInformationMessage('Simulation cancelled due to validation warning.');
                return;
            }
        }

        // Create and show the simulation panel
        const panel = SimulationPanel.createOrShow(context);
        panel.updateResults(
            { success: false, error: 'Running simulation...', validationWarnings },
            contractId,
            functionName,
            args
        );

        // Show progress indicator
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Simulating Soroban Transaction',
                cancellable: false
            },
            async (progress: vscode.Progress<{ message?: string; increment?: number }>) => {
                progress.report({ increment: 0, message: 'Initializing...' });

                let result;

                if (useLocalCli) {
                    // Use local CLI
                    progress.report({ increment: 30, message: 'Using Stellar CLI...' });
                    
                    // Try to find CLI if configured path doesn't work
let actualCliPath = cliPath;
let cliService = new SorobanCliService(actualCliPath, source);

if (!cliService.isCliAvailable()) {
    const foundPath = await SorobanCliService.findCliPath();
                        const suggestion = foundPath 
                            ? `\n\nFound Stellar CLI at: ${foundPath}\nUpdate your stellarSuite.cliPath setting to: "${foundPath}"`
                            : '\n\nCommon locations:\n- ~/.cargo/bin/stellar\n- /usr/local/bin/stellar\n\nOr install Stellar CLI: https://developers.stellar.org/docs/tools/cli';
                        
                        result = {
                            success: false,
                            error: `Stellar CLI not found at "${cliPath}".${suggestion}`
                        };
                    } else {
                        progress.report({ increment: 50, message: 'Executing simulation...' });
                        result = await cliService.simulateTransaction(contractId, functionName, args, network);
                    }
                } else {
                    // Use RPC
                    progress.report({ increment: 30, message: 'Connecting to RPC...' });
                    const rpcService = new RpcService(rpcUrl);
                    
                    progress.report({ increment: 50, message: 'Executing simulation...' });
                    result = await rpcService.simulateTransaction(contractId, functionName, args);
                }

                progress.report({ increment: 100, message: 'Complete' });

                // Update panel with results
                panel.updateResults({ ...result, validationWarnings }, contractId, functionName, args);

                // Update sidebar view
                if (sidebarProvider) {
                    sidebarProvider.showSimulationResult(contractId, result);
                }

                // Show notification
                if (result.success) {
                    vscode.window.showInformationMessage('Simulation completed successfully');
                } else {
                    const notificationMessage = result.errorSummary
                        ? `Simulation failed: ${result.errorSummary}`
                        : `Simulation failed: ${result.error}`;
                    vscode.window.showErrorMessage(notificationMessage);
                }
            }
        );
    } catch (error) {
        const formatted = formatError(error, 'Simulation');
        vscode.window.showErrorMessage(`${formatted.title}: ${formatted.message}`);
    }
}