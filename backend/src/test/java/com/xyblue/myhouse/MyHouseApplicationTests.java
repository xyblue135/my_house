package com.xyblue.myhouse;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest(properties = {
    "myhouse.data-dir=target/test-data",
    "myhouse.rabbitmq.enabled=false"
})
class MyHouseApplicationTests {

    @Test
    void contextLoads() {}
}
