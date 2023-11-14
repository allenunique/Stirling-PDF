import { organizeWaitOperations } from "./organizeWaitOperations";
import { Action } from "../../declarations/Action";
import { OperationsType } from "../../src/index";
import { PdfFile } from "../wrappers/PdfFile";

import { ValuesType } from "../../declarations/TypeScriptUtils"

export async function * traverseOperations(operations: Action[], input: PdfFile[] | PdfFile, Operations: OperationsType) {
    const waitOperations = organizeWaitOperations(operations);
    let results: PdfFile[] = [];
    yield* nextOperation(operations, input);
    return results;

    async function * nextOperation(actions: Action[], input: PdfFile[] | PdfFile): AsyncGenerator<any, any, unknown> {
        if(Array.isArray(actions) && actions.length == 0) { // isEmpty
            if(Array.isArray(input)) {
                console.log("operation done: " + input[0].filename + (input.length > 1 ? "+" : ""));
                results = results.concat(input);
                return;
            }
            else {
                console.log("operation done: " + input.filename);
                results.push(input);
                return;
            }
        }
    
        for (let i = 0; i < actions.length; i++) {
            yield* computeOperation(actions[i], structuredClone(input));
        }
    }
    
    async function * computeOperation(action: Action, input: PdfFile|PdfFile[]) {
        yield "Starting: " + action.type;
        switch (action.type) {
            case "done": // Skip this, because it is a valid node.
                break;
            case "wait":
                const waitOperation = waitOperations[action.values.id];

                if(Array.isArray(input)) {
                    waitOperation.input.concat(input); // TODO: May have unexpected concequences. Needs further testing!
                }
                else {
                    waitOperation.input.push(input);
                }

                waitOperation.waitCount--;
                if(waitOperation.waitCount == 0 && waitOperation.doneOperation.actions) {
                    yield* nextOperation(waitOperation.doneOperation.actions, waitOperation.input);
                }
                break;
            case "extract":
                yield* nToN(input, action, async (input) => {
                    const newPdf = await Operations.selectPages({file: input, pagesToExtractArray: action.values["pagesToExtractArray"]});
                    newPdf.filename += "_extractedPages";
                    return newPdf;
                });
                break;
            case "impose":
                yield* nToN(input, action, async (input) => {
                    const newPdf = await Operations.impose({file: input, nup: action.values["nup"], format: action.values["format"]});
                    newPdf.filename += "_imposed";
                    return newPdf;
                });
                break;
            case "merge":
                yield* nToOne(input, action, async (inputs) => {
                    const newPdf = await Operations.mergePDFs({files: inputs});
                    newPdf.filename = inputs.map(input => input.filename).join("_and_") + "_merged";
                    return newPdf;
                });
                break;
            case "rotate":
                yield* nToN(input, action, async (input) => {
                    const newPdf = await Operations.rotatePages({file: input, rotation: action.values["rotation"]});
                    newPdf.filename += "_turned";
                    return newPdf;
                });
                break;
            case "split":
                // TODO: A split might break the done condition, it may count multiple times. Needs further testing!
                yield* oneToN(input, action, async (input) => {
                    const splitResult = await Operations.splitPDF({file: input, splitAfterPageArray: action.values["splitAfterPageArray"]});
                    for (let j = 0; j < splitResult.length; j++) {
                        splitResult[j].filename = splitResult[j].filename + "_split" + j;
                    }
                    return splitResult;
                });
                break;
            case "updateMetadata":
                yield* nToN(input, action, async (input) => {
                    const newPdf = await Operations.updateMetadata({file: input, ...action.values["metadata"]});
                    newPdf.filename += "_metadataEdited";
                    return newPdf;
                });
                break;
            case "sortPagesWithPreset":
                yield* nToN(input, action, async (input) => {
                    const newPdf = await Operations.sortPagesWithPreset({file: input, sortPreset: action.values["sortPreset"], fancyPageSelector: action.values["fancyPageSelector"]});
                    newPdf.filename += "_pagesOrganized";
                    return newPdf;
                });
                break;
            case "removeBlankPages":
                yield* nToN(input, action, async (input) => {
                    const newPdf = await Operations.removeBlankPages({file: input, whiteThreashold: action.values["whiteThreashold"]});
                    newPdf.filename += "_removedBlanks";
                    return newPdf;
                });
                break;
            case "splitOn":
                yield* oneToN(input, action, async (input) => {
                    const splitResult = await Operations.splitOn({file: input, type: action.values["type"], whiteThreashold: action.values["whiteThreashold"]});
                    for (let j = 0; j < splitResult.length; j++) {
                        splitResult[j].filename = splitResult[j].filename + "_split" + j;
                    }
                    return splitResult;
                });
                break;
            default:
                throw new Error(`${action.type} not implemented yet.`);
                break;
        }
    }

    /**
     * 
     * @param {PdfFile|PdfFile[]} input 
     * @param {JSON} action
     * @returns {undefined}
     */
    async function * nToOne(inputs: PdfFile|PdfFile[], action: Action, callback: (pdf: PdfFile[]) => Promise<PdfFile>): AsyncGenerator<any, any, unknown> {
        const input = Array.isArray(inputs) ? inputs : [inputs]; // Convert single values to array, keep arrays as is.
        
        const newInputs = await callback(input);
        if (action.actions) {
            yield* nextOperation(action.actions, newInputs);
        }
    }

    /**
     * 
     * @param {PdfFile|PdfFile[]} input 
     * @param {JSON} action
     * @returns {undefined}
     */
    async function * oneToN(input: PdfFile|PdfFile[], action: Action, callback: (pdf: PdfFile) => Promise<PdfFile[]>): AsyncGenerator<any, any, unknown> {
        if(Array.isArray(input)) {
            let output: PdfFile[] = [];
            for (let i = 0; i < input.length; i++) {
                output = output.concat(await callback(input[i]));
            }
            if (action.actions) {
                yield* nextOperation(action.actions, output);
            }
        }
        else {
            const nextInput = await callback(input);
            if (action.actions) {
                yield* nextOperation(action.actions, nextInput);
            }
        }
    }

    async function * nToN(input: PdfFile|PdfFile[], action: Action, callback: (pdf: PdfFile) => Promise<PdfFile>): AsyncGenerator<any, any, unknown> {
        if(Array.isArray(input)) {
            const nextInputs: PdfFile[] = []
            for (let i = 0; i < input.length; i++) {
                nextInputs.concat(await callback(input[i]));
            }
            if (action.actions) {
                yield* nextOperation(action.actions, nextInputs);
            }
        }
        else {
            const nextInput = await callback(input);
            if (action.actions) {
                yield* nextOperation(action.actions, nextInput);
            }
        }
    }
}