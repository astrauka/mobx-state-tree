import { recordActions, types, getSnapshot, onAction, applyPatch, applySnapshot } from "../src"
import { test } from "ava"

declare var Buffer
/// Simple action replay and invocation

const Task = types.model(
    {
        done: false
    },
    {
        toggle() {
            this.done = !this.done
            return this.done
        }
    }
)

test("it should be possible to invoke a simple action", t => {
    const t1 = Task.create()
    t.is(t1.done, false)

    t.is(t1.toggle(), true)
    t.is(t1.done, true)
})

test("it should be possible to record & replay a simple action", t => {
    const t1 = Task.create()
    const t2 = Task.create()

    t.is(t1.done, false)
    t.is(t2.done, false)
    const recorder = recordActions(t1)

    t1.toggle()
    t1.toggle()
    t1.toggle()

    t.deepEqual(recorder.actions, [
        { name: "toggle", path: "", args: [] },
        { name: "toggle", path: "", args: [] },
        { name: "toggle", path: "", args: [] }
    ])

    recorder.replay(t2)
    t.is(t2.done, true)
})

test("applying patches should be recordable and replayable", t => {
    const t1 = Task.create()
    const t2 = Task.create()

    const recorder = recordActions(t1)
    t.is(t1.done, false)

    applyPatch(t1, { op: "replace", path: "done", value: true })
    t.is(t1.done, true)

    t.deepEqual(recorder.actions, [
        {
            name: "@APPLY_PATCHES",
            path: "",
            args: [[{ op: "replace", path: "done", value: true }]]
        }
    ])

    recorder.replay(t2)
    t.is(t2.done, true)
})

test("applying snapshots should be recordable and replayable", t => {
    const t1 = Task.create()
    const t2 = Task.create()

    const recorder = recordActions(t1)
    t.is(t1.done, false)

    applySnapshot(t1, { done: true })
    t.is(t1.done, true)

    t.deepEqual(recorder.actions, [
        {
            name: "@APPLY_SNAPSHOT",
            path: "",
            args: [{ done: true }]
        }
    ])

    recorder.replay(t2)
    t.is(t2.done, true)
})

// Complex actions
const Customer = types.model("Customer", {
    id: types.identifier(types.number),
    name: types.string
})

const Order = types.model(
    "Order",
    {
        customer: types.maybe(types.reference(Customer))
    },
    {
        setCustomer(customer) {
            this.customer = customer
        }
    }
)

const OrderStore = types.model("OrderStore", {
    customers: types.array(Customer),
    orders: types.array(Order)
})

function createTestStore() {
    const store = OrderStore.create({
        customers: [{ id: 1, name: "Mattia" }],
        orders: [
            {
                customer: null
            }
        ]
    })
    onAction(store, () => {})
    return store
}

test("it should be possible to pass a complex object", t => {
    const store = createTestStore()
    const recorder = recordActions(store)

    t.is(store.customers[0].name, "Mattia")
    store.orders[0].setCustomer(store.customers[0])
    t.is(store.orders[0].customer!.name, "Mattia")
    t.is(store.orders[0].customer, store.customers[0])
    t.deepEqual(getSnapshot(store) as any, {
        customers: [
            {
                id: 1,
                name: "Mattia"
            }
        ],
        orders: [
            {
                customer: 1
            }
        ]
    })

    t.deepEqual(recorder.actions, [
        { name: "setCustomer", path: "/orders/0", args: [{ $ref: "../../customers/0" }] }
    ])

    const store2 = createTestStore()
    recorder.replay(store2)
    t.is(store2.orders[0].customer, store2.customers[0])
    t.deepEqual(getSnapshot(store2), getSnapshot(store))
})

test("it should not be possible to set the wrong type", t => {
    const store = createTestStore()

    t.throws(
        () => {
            store.orders[0].setCustomer(store.orders[0])
        }, // wrong type!
        "[mobx-state-tree] Error while converting <Order@/orders/0> to `reference(Customer) | null`:\n" +
            "value of type Order: <Order@/orders/0> is not assignable to type: `reference(Customer) | null`, expected an instance of `reference(Customer) | null` or a snapshot like `(reference(Customer) | null?)` instead."
    )
})

test("it should not be possible to pass the element of another tree", t => {
    const store1 = createTestStore()
    const store2 = createTestStore()

    t.throws(() => {
        store1.orders[0].setCustomer(store2.customers[0])
    }, "Argument 0 that was passed to action 'setCustomer' is a model that is not part of the same state tree. Consider passing a snapshot or some representative ID instead")
})

test("it should not be possible to pass an unserializable object", t => {
    const store = createTestStore()
    const circular = { a: null as any }
    circular.a = circular

    t.throws(
        () => store.orders[0].setCustomer(circular),
        "Argument 0 that was passed to action 'setCustomer' is not serializable."
    )

    t.throws(
        () => store.orders[0].setCustomer(new Buffer("bla")),
        "Argument 0 that was passed to action 'setCustomer' should be a primitive, model object or plain object, received a Buffer"
    )
})

test("it should be possible to pass a complex plain object", t => {
    const t1 = Task.create()
    const t2 = Task.create()

    const recorder = recordActions(t1)
    ;(t1 as any).toggle({ bla: ["nuff", ["said"]] }) // nonsense, but serializable!

    t.deepEqual(recorder.actions, [
        { name: "toggle", path: "", args: [{ bla: ["nuff", ["said"]] }] }
    ])

    recorder.replay(t2)
    t.is(t2.done, true)
})

test("action should be bound", t => {
    const task = Task.create()
    const f = task.toggle
    t.is(f(), true)
})

test("snapshot should be available and updated during an action", t => {
    const Model = types.model(
        {
            x: types.number
        },
        {
            inc() {
                this.x += 1
                const res = getSnapshot(this as any).x
                this.x += 1
                return res
            }
        }
    )

    const a = Model.create({ x: 2 })
    t.is(a.inc(), 3)
    t.is(a.x, 4)
    t.is(getSnapshot(a).x, 4)
})
