package com.xyblue.itemnest;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.LinkedHashMap;
import java.util.Map;

import com.xyblue.itemnest.repository.LifeRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest(properties = {
    "itemnest.data-dir=target/test-data",
    "itemnest.rabbitmq.enabled=false"
})
class ItemNestApplicationTests {
    @Autowired LifeRepository life;

    @Test
    void contextLoads() {}

    @Test
    void lifeHubSupportsCreateUpdateAndDelete() {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("owner_id", 1);
        payload.put("kind", "habit");
        payload.put("title", "测试习惯");
        payload.put("target_value", 30);
        Map<String, Object> created = life.create(payload);
        long id = ((Number) created.get("id")).longValue();

        assertThat(created.get("kind")).isEqualTo("habit");
        assertThat(life.list("habit", "测试习惯", 1L, null, false, 20)).isNotEmpty();

        life.update(id, Map.of("pinned", true, "status", "ACTIVE"));
        Map<String, Object> updated = life.get(id);
        assertThat(((Number) updated.get("pinned")).intValue()).isEqualTo(1);

        assertThat(life.delete(id)).isTrue();
        assertThat(life.get(id)).isNull();
    }
}
