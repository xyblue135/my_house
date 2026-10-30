package com.xyblue.myhouse;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableAsync;

@EnableAsync
@SpringBootApplication
public class MyHouseApplication {
    public static void main(String[] args) {
        SpringApplication.run(MyHouseApplication.class, args);
    }
}
