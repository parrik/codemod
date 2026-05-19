package com.example;

// Rename target for the codemod. Stubbed so post-codemod sources can compile
// — that way `javac` exit code distinguishes correct rewrites from incorrect
// ones, rather than every rewrite failing for "class doesn't exist" reasons.
public class LegacyUtilDate {
    private long epochMillis;

    public LegacyUtilDate() {
        this.epochMillis = System.currentTimeMillis();
    }

    public LegacyUtilDate(long epochMillis) {
        this.epochMillis = epochMillis;
    }

    public long getEpochMillis() {
        return this.epochMillis;
    }
}
