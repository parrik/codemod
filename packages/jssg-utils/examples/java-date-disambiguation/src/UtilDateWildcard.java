package com.example;

// Wildcard import — `Date` here resolves to java.util.Date.
// This is the edge case that simple getImport() check misses;
// coversImport() handles it correctly.
import java.util.*;

class UtilDateWildcard {
    Date createdAt = new Date();
    List<Date> history = new ArrayList<>();
}
