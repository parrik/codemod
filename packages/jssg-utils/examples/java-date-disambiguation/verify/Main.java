package com.example;

// Downstream code that depends on the ORIGINAL semantics of
// BrokenInnerShadow.InnerUser.local — specifically, that it is the inner
// `Date` class with a `.label` field, not java.util.Date / LegacyUtilDate.
//
// Compile and run before the codemod: succeeds, prints the label.
// Compile after the codemod: fails — but the error lands HERE in Main.java,
// not in BrokenInnerShadow.java. The codemod-touched file looks fine; the
// downstream consumer carries the failure.
//
// This is exactly the failure mode LST / type-attributed analysis prevents:
// pattern-based rewrites can produce silently-wrong sources whose damage
// only surfaces in third-party callers.
public class Main {
    public static void main(String[] args) {
        BrokenInnerShadow.InnerUser u = new BrokenInnerShadow.InnerUser();
        String s = u.local.label;
        System.out.println("local.label = " + s);
    }
}
