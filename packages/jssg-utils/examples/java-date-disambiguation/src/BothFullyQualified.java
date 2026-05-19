package com.example;

// No imports — both used via fully-qualified names.
// This is the only legal way to use both Dates in the same file.
class BothFullyQualified {
    java.util.Date moment = new java.util.Date();
    java.sql.Date day = new java.sql.Date(0L);

    java.util.Date utilDate() {
        return new java.util.Date();
    }

    java.sql.Date sqlDate() {
        return new java.sql.Date(0L);
    }
}
