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
            if (!Util.isFalsey(operation))
                Watcher.sendOperationMessage(operation);
        };

        var handler = {
            set (obj, prop, value) {
                const oldVal = obj[prop];

                //'value' is potentially already an object, in which case
                //getBoxedValue(...) will just return it unchanged.
                var boxedVal = Watcher.getBoxedValue(value);

                Reflect.set(obj, prop, boxedVal);

                if (obj.watcher_dslogic.isTrackedProperty(obj, prop)) {
                    onChange(obj, prop, oldVal, boxedVal);
                }

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
                    if (dsLogic.isTrackedProperty(obj, property)) {
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
        if (Util.isFalsey(val) || !Util.isPrimitive(val))
            return val;

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
        if (Util.isFalsey(element)) {
            return -1;
        }

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

        this.proxifyTrackedFunctions();

        //Initialize data structure in Lucidity
        this.ds_id = this.sendCreateOp();
        var initializeOps = this.getInitializeOps();
        if (initializeOps.length !== 0) {
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

                                        //IMPORTANT: this is happening.
                                        //Just box any primitive that's potentially getting added to our DS
                                        for (var i = 0; i < argumentsList.length; i++) {
                                            argumentsList[i] = Watcher.getBoxedValue(argumentsList[i]);
                                        }

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

    isTrackedProperty(object, propertyName) {
        throw "Subclasses must override isTrackedProperty!";   
    }

    //Returns a 'modification' operation, e.g. ADD/REMOVE
    modificationOp(location, elementValue, opType) {
        if (!Array.isArray(location))
            throw "'location' argument in modificationOp(...) must be an array.";

        return {
            targetID: this.ds_id,
            elementID: Watcher.elementId(elementValue),
            type: opType,
            location: location,
            untypedArgument: DSLogic.operationArgumentToString(elementValue),
            timestamp: 0
        };
    }

    //Returns a compound operation comprised of the given operations
    compoundOp(...subOps) {
        if (subOps.length >= 1 && Array.isArray(subOps[0]))
            throw "compoundOp() uses the spread operator; don't pass it an array of things."

        return {
            targetID: this.ds_id,
            elementID: "null",
            type: OpType.COMPOUND,
            subOperations: subOps,
            timestamp: 0
        }
    }

    static operationArgumentToString(arg) {
        if (arg === null) {
            return 'null';
        } else if (arg === undefined) {
            return 'undefined';
        } else if (typeof arg !== 'string') {
            return new String(arg);
        } else {
            return arg;
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

        this.old_ds = this.ds.slice();
    }

    getInitializeOps() {
        var addOps = [];
        this.ds.forEach((value, i) => {
            addOps.push(this.modificationOp([i], value, OpType.ADD));
        });

        return addOps;
    }

    //Overrides parent function
    //Generate add/remove operations based on property change data
    operationFromChangeData(obj, prop, oldVal, newVal) {
        // console.log("direct array set; list[" + prop + "] = ", newVal, "; was ", oldVal);

        var operation;
        if (prop == 'length' && newVal < oldVal) { //length was reduced; truncate list

            operation = this.lengthReducedOp(oldVal, newVal);
        } else if (Util.isNumber(prop)) { //setting some array val, e.g. 

            var index = Number(prop);
            operation = this.arraySetOp(index, oldVal, newVal);
        }

        //Copy whole array after every operation so we can access the old state of the array on the next
        //property change event.
        this.old_ds = this.ds.slice();

        return operation;
    }

    lengthReducedOp(oldLength, newLength) {
        var removeOps = [];
        for (var i = newLength; i < oldLength; i++) {
            removeOps.push(this.modificationOp([newLength], this.old_ds[i], OpType.REMOVE));
        }
        var compound = this.compoundOp(...removeOps);

        return compound;
    }

    //Returns the operation for setting the value of some array element
    arraySetOp(index, oldVal, newVal) {
        var addOp = this.modificationOp([index], newVal, OpType.ADD);

        if (index >= this.old_ds.length) {

             return addOp;
        }
        else { //Remove the old value first

            var removeOp = this.modificationOp([index], oldVal, OpType.REMOVE);
            var setOp = this.compoundOp(removeOp, addOp);

            return setOp;
        }
    }

    //Overrides parent function
    proxifyTrackedFunctions() {
        //We don't need any function-specific operation generation for arrays
    }

    isTrackedProperty(obj, propertyName) {
        //If it is a number, it's an array element
        //we also check that obj is this.ds since we might
        //be getting asked about a 'nested' property on the ds
        //and we don't want to track any of those.
        return obj === this.ds && (Util.isNumber(propertyName) || propertyName === 'length');
    }
}

class Util {
    static isPrimitive(val) {
        return val !== Object(val);
    }

    static isNumber(val) {
        return !isNaN(val);
    }

    static isFalsey(val) {
        return val === null || val === undefined;
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