package com.example;

import java.util.Date;

// JLS §6.4.1: a nested type declaration shadows a single-type-import
// of the same simple name within its scope. So the bare `Date` inside
// `InnerUser` refers to the inner class, NOT java.util.Date.
//
// Expected correct behavior:
//   - The `import java.util.Date;` and the `realUtilDate` field below
//     should be rewritten (those genuinely use java.util.Date).
//   - The `Date local = new Date()` line inside `InnerUser` must NOT
//     be rewritten — it refers to the inner class.
class BrokenInnerShadow {
    Date realUtilDate = new Date();

    static class InnerUser {
        static class Date {
            String label = "I am the inner Date, not java.util.Date";
        }

        Date local = new Date();   // <- inner class. Heuristic gets this wrong.
    }
}
