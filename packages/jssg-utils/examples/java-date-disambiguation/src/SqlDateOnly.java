package com.example;

import java.sql.Date;

class SqlDateOnly {
    Date birthday = new Date(0L);

    Date asOf(long epochMillis) {
        return new Date(epochMillis);
    }
}
