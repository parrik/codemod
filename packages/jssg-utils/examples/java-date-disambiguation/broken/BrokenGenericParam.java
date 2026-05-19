package com.example;

import java.util.Date;

// `Date` is being used here as a TYPE PARAMETER name, not as a reference
// to java.util.Date. Within the body of `Container`, the bare `Date`
// refers to the type variable.
//
// Expected correct behavior:
//   - The `import java.util.Date;` is genuinely about java.util.Date and
//     should be rewritten.
//   - The `lastSeen` field of type `java.util.Date` should be rewritten.
//   - The type parameter `<Date>` and its uses (`Date value`, the cast,
//     the method parameter) must NOT be rewritten — they are a generic
//     type variable.
class BrokenGenericParam {
    Date lastSeen = new Date();

    static class Container<Date> {
        Date value;

        Date get() {
            return value;
        }

        void put(Date d) {
            this.value = d;
        }
    }
}
