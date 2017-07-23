class Watcher {

    constructor() {

    }

    //Unique identifiers for data structures, sent over in each Lucidity operation
    static nextId() {
        if (Watcher.next_id === undefined) 
            Watcher.next_id = 0;

        return Watcher.next_id++;
    }

    static sendOperationMessage(operation) {
        Watcher.sendMessage('op|' + JSON.stringify(operation));
    }

    watchify(object) {
        var proxy = this.getWatchifyProxy(object);

        return proxy;
    }

    //Returns a Proxy object for the given object which will send Lucidity data structure operation
    //info when certain properties are modified or functions are called on the given object.
    getWatchifyProxy(object) {
        //Augment object with ds type-specific logic for handling property changes and method calls
        object.watcher_dslogic = this.newDSLogicForObject(object);

        var onChange = (obj, prop, oldVal, newVal) => {
            
            var operation = obj.watcher_dslogic.operationFromChangeData(obj, prop, oldVal, newVal);
            if (operation !== null)
                Watcher.sendOperationMessage(operation);
        };

        var handler = {
            set (obj, prop, value) {
                const oldVal = obj[prop];
                Reflect.set(obj, prop, value);
                onChange(obj, prop, oldVal, value);

                return true;
            },
        }

        var proxy = new Proxy(object, handler);

        return proxy;
    }

    newDSLogicForObject(obj) {
        if (Array.isArray(obj)) {
            return new ListLogic(obj);
        } else {
            throw "We can only watch arrays right now!";
        }   
    }

    //Traverses the object tree and watchifies every sub object too
    watchifyRecursive(object) {

    }

    //Replaces object property with a watched version of the given property
    watch(object, property) {
        object[property] = this.watchify(object[property]);
    }

    watchScope(scopeString) {
        //parse scopeString
        //find variable declarations
        //watch all watchable declared objects/arrays
    }    
}

//Does all the data structure type-specific work to generate Lucidity operations when
//an associated object (named 'ds') is modified in certain ways.
class DSLogic {
    constructor(ds, dsType) {
        this.ds = ds;
        this.dsType = dsType;
        this.trackedFunctionCallStack = [];

        this.ds_id = this.sendCreateOp();
    }

    sendCreateOp() {
        var operation = {
            dataStructureType: this.dsType,
            targetID: Watcher.nextId(),
            type: 'create',
            location: [-1],
            timestamp: 0
        };

        Watcher.sendOperationMessage(operation);

        return operation.targetID;
    }

    //Should be implemented by subclasses. Called whenever a property on 'ds' is modified.
    //On some of these modifications nothing will happen, on others we'll generate appropriate
    //Lucidity operations.
    operationFromChangeData(obj, prop, oldVal, newVal) {
        throw "Subclass must override operationFromChangeData!";
    }

    trackedFunctionStarted(funcName, args) {
        this.trackedFunctionCallStack.push(funcName);

        //If present, call a subclasses method which will generate a ds operation
        //corresponding to the tracked function's behavior.
        if (this[funcName + 'Op'] !== undefined) {
            this[funcName + 'Op'](...args);
        }

        // console.log("starting: " + funcName + "; args: ", args, "; stack: ", this.trackedFunctionCallStack);
    }

    trackedFunctionEnded(funcName) {
        this.trackedFunctionCallStack.pop();
        // console.log("finished: " + funcName + "; stack: ", this.trackedFunctionCallStack);
    }

    currentlyExecutingTrackedFunction() {
        return this.trackedFunctionCallStack[this.trackedFunctionCallStack.length - 1];
    }

    //Replace function named 'funcName' on 'obj' with a function Proxy used to notify handlers before
    //the function starts and after it ends.
    proxifyFunction(obj, funcName) {
        var self = this;

        obj[funcName] = new Proxy(obj[funcName], {apply: function(target, thisArg, argumentsList) {
                                        self.trackedFunctionStarted(funcName, argumentsList);
                                        Reflect.apply(target, thisArg, argumentsList)
                                        self.trackedFunctionEnded(funcName);
                                    }});
    }

    //Should be implemented by subclasses. Subclasses should use proxifyFunction(...) to 
    //set up tracking on all functions which should be tracked (i.e. those for which we generate
    //Lucidity operations on their invokation).
    proxifyTrackedFunctions() {
        throw "Subclass must override proxifyTrackedFunctions!";
    }
}

//Needs 'logics' for these types:
// []
// Map
// custom treenode class
// other js object

class ListLogic extends DSLogic {

    constructor(ds) {
        super(ds, 'list');
    }

    //Overrides parent function
    operationFromChangeData(obj, prop, oldVal, newVal) {
        var executingFunc = this.currentlyExecutingTrackedFunction();

        if (executingFunc === undefined ) { //Setting array value directly, e.g. a[3] = 5;

            console.log("direct array set; list[" + prop + "] = " + newVal + "; was " + oldVal);
            return {coolStuff: "this is another test"};

        } else {

            return null;
        }
    }

    pushOp(element) {

        console.log('push op:', element);
        Watcher.sendOperationMessage({push: "this is another test", targetID: this.ds_id});
    }

    popOp() {

        return {coolStuff: "this is another test"};
    }

    shiftOp() {

        return {coolStuff: "this is another test"};
    }

    unshiftOp(element) {

        return {coolStuff: "this is another test"};
    }

    spliceOp(start, deleteCount, ...newItems) {
        
        console.log('spliceOp: ', newItems);
        return {coolStuff: "this is another test"};
    }

    //Overrides parent function
    proxifyTrackedFunctions() {
        var list = this.ds;

        this.proxifyFunction(list, 'push');
        this.proxifyFunction(list, 'pop');
        this.proxifyFunction(list, 'shift');
        this.proxifyFunction(list, 'splice');
        this.proxifyFunction(list, 'unshift');
    }
}

// var w = new Watcher();

// Watcher.sendMessage = function(message) {
//     //send network message to Lucidity

//     console.log("sending: " + message);
// };

// var a = w.watchify([1, 2, 3, 4, 5, 6, 7, 8]);


// a[8] = 1234;
// a.push('xyz');
// a.splice(2, 1, 'instead', 'and_another', 'blah');







//Access global scope anywhere:
// var global = Function('return this')();



// var global = {};

// Object.defineProperty(global, '__stack', {
//   get: function(){
//     var orig = Error.prepareStackTrace;
//     Error.prepareStackTrace = function(_, stack){ return stack; };
//     var err = new Error;
//     Error.captureStackTrace(err, arguments.callee);
//     var stack = err.stack;
//     Error.prepareStackTrace = orig;
//     return stack;
//   }
// });

// Object.defineProperty(global, '__line', {
//   get: function(){
//     return global.__stack[1].getLineNumber();
//   }
// });

// console.log(global.__line);