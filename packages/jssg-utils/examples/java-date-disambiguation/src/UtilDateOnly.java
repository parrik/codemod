package com.example;

import java.util.Date;

class UtilDateOnly {
    Date createdAt = new Date();
    Date updatedAt;

    void touch() {
        this.updatedAt = new Date();
    }
}
