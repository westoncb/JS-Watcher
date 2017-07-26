class Watcher {
    constructor() {

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

                var valToStore;
                var shouldBoxValue = object.watcher_dslogic.shouldTrackIdentiesForProperty(obj, prop);

                if (value !== Util.isPrimitive(value) && shouldBoxValue) {
                    valToStore = Watcher.getBoxedValue(value);
                } else {
                    valToStore = value;
                }

                Reflect.set(obj, prop, valToStore);

                onChange(obj, prop, oldVal, valToStore);

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

    //Walk all properties and box primitive values that need unique identifiers
    //associated with them.
    static objectifyDS(obj, dsLogic, visited) {
        if (visited === undefined)
            visited = [];

        for (var property in obj) {
            if (obj.hasOwnProperty(property)) {
                if (Util.isPrimitive(obj[property])) {
                    if (dsLogic.shouldTrackIdentiesForProperty(obj, property)) {
                        Watcher.objectifyProperty(obj, property);
                    }
                } else if (!visited.includes(obj[property])) {
                        visited.push(obj[property]);
                        Watcher.objectifyDS(obj[property], dsLogic, visited);
                }

            }
        }
    }

    static objectifyProperty(obj, property) {
        obj[property] = Watcher.getBoxedValue(obj[property]);
    }

    static getBoxedValue(val) {
        if (typeof val === 'string') {
            return new String(val);
        } else if (typeof val === 'number') {
            return new Number(val);
        } else { //boolean
            return new Boolean(val);
        }
    }

    //If we'd like Lucidiy to produce correct 'move' animations when an element moves from
    //one position to another (or from one DS to another), we need to uniquely identify elements.
    static elementId(element) {
        if (element.watcher_element_id === undefined) {
            Object.defineProperty(element, "watcher_element_id", {
                value: Watcher.nextElementId(),
                enumerable: false,
                writable: false
            });
        }

        return element.watcher_element_id;
    }

    static nextElementId() {
        if (Watcher.next_element_id === undefined)
            Watcher.next_element_id = 0;

        return Watcher.next_element_id++;
    }

    //Unique identifiers for data structures are sent over in each Lucidity operation.
    //These are generated once, each time a new data structure is created, but then
    //every operation meant to be applied to that data structure includes the DS's ID.
    static nextDSId() {
        if (Watcher.next_ds_id === undefined) 
            Watcher.next_ds_id = 0;

        return Watcher.next_ds_id++;
    }
}

const OpType = {
    ADD: 'add',
    REMOVE: 'remove',
    CREATE: 'create',
    COMPOUND: 'compound'
}

//Does all the data structure type-specific work to generate Lucidity operations when
//an associated object (named 'ds') is modified in certain ways.
class DSLogic {
    constructor(ds, dsType) {
        this.ds = ds;
        this.dsType = dsType;
        this.trackedFunctionCallStack = [];

        //Need to box all primitive properties since there is no way of associating 
        //unique identifiers with primitive values (that I can think of).
        //Order matters when calling this (i.e. it probably shouldn't be called earlier
        //nor later than on the following line).
        Watcher.objectifyDS(ds, this);

        //Initialize data structure in Lucidity
        this.ds_id = this.sendCreateOp();
        var initializeOps = this.getInitializeOps();
        if (initializeOps.length === 0) {
            Watcher.sendOperationMessage(this.compoundOp(...initializeOps));
        }
    }

    sendCreateOp() {
        var operation = {
            dataStructureType: this.dsType,
            targetID: Watcher.nextDSId(),
            type: OpType.CREATE,
            location: [-1],
            timestamp: 0
        };

        Watcher.sendOperationMessage(operation);

        return operation.targetID;
    }

    //If the data structure should be initialize with some elements, sublcasses should
    //return the operations that will add those elements here. Return an empty array
    //if there are no initial values.
    getInitializeOps() {
        throw "Subclasses must override getInitializeOps!";
    }

    //Should be implemented by subclasses. Called whenever a property on 'ds' is modified.
    //On some of these modifications nothing will happen, on others we'll generate appropriate
    //Lucidity operations.
    operationFromChangeData(obj, prop, oldVal, newVal) {
        throw "Subclasses must override operationFromChangeData!";
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
        throw "Subclasses must override proxifyTrackedFunctions!";
    }

    shouldTrackIdentiesForProperty(propertyName) {
        throw "Subclasses must override shouldTrackIdentiesForProperty!";   
    }

    modificationOp(location, elementValue, opType) {
        return {
            targetID: this.ds_id,
            elementID: Watcher.elementId(elementValue),
            type: opType,
            location: location,
            untypedArgument: elementValue,
            timestamp: 0
        };
    }

    compoundOp(...subOps) {
        return {
            targetID: this.ds_id,
            elementID: "null",
            type: OpType.COMPOUND,
            subOperations: subOps,
            timestamp: 0
        }
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

    getInitializeOps() {
        var addOps = [];
        this.ds.forEach((value, i) => {
            addOps.push(this.arraySetOp(i, undefined, value));
        });

        return addOps;
    }

    //Overrides parent function
    operationFromChangeData(obj, prop, oldVal, newVal) {
        var executingFunc = this.currentlyExecutingTrackedFunction();

        if (executingFunc === undefined ) { //Setting array value directly, e.g. a[3] = 5;
            // console.log("direct array set; list[" + prop + "] = " + newVal + "; was " + oldVal);

            var index = Number(prop);
            return this.arraySetOp(index, oldVal, newVal);

        } else {

            return null;
        }
    }

    arraySetOp(index, oldVal, newVal) {
        var addOp = this.modificationOp([index], newVal, OpType.ADD);

        if (oldVal === undefined) {
            return addOp;
        }
        else { //Remove the old value first
            var removeOp = this.modificationOp([index], oldVal, OpType.REMOVE);
            var setOp = this.compoundOp(removeOp, addOp);

            return setOp;
        }
    }

    pushOp(element) {

        console.log('push op:', element);
        Watcher.sendOperationMessage({push: "this is another test", targetID: this.ds_id});
    }

    popOp() {

        return {"dataStructureType":"list","targetID":0,"type":"create","location":[-1],"timestamp":0};
    }

    shiftOp() {

        return {"dataStructureType":"list","targetID":0,"type":"create","location":[-1],"timestamp":0};
    }

    unshiftOp(element) {

        return {"dataStructureType":"list","targetID":0,"type":"create","location":[-1],"timestamp":0};
    }

    spliceOp(start, deleteCount, ...newItems) {
        
        console.log('spliceOp: ', newItems);
        return {"dataStructureType":"list","targetID":0,"type":"create","location":[-1],"timestamp":0};
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

    shouldTrackIdentiesForProperty(obj, propertyName) {
        //If it is a number, it's an array element
        //we also check that obj is this.ds since we might
        //be getting asked about a 'nested' property on the ds
        //and we don't want to track any of those.
        return obj === this.ds && !isNaN(propertyName);
    }
}

class Util {
    static isPrimitive(val) {
        return val !== Object(val);
    }
}

exports.Watcher = Watcher;

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