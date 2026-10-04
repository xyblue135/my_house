package com.xyblue.itemnest.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.xyblue.itemnest.repository.HistoryRepository;
import com.xyblue.itemnest.repository.InventoryRepository;
import com.xyblue.itemnest.repository.LifecycleRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest(properties = {"itemnest.data-dir=target/test-data-ai-scope", "itemnest.rabbitmq.enabled=false"})
class AiScopeTests {
    @Autowired InventoryRepository repository;
    @Autowired HistoryRepository history;
    @Autowired AttachmentService attachments;
    @Autowired LifecycleRepository lifecycle;
    @Autowired ObjectMapper mapper;
    @TempDir Path settingsDir;
    AiService ai;
    String keyword;
    long itemA;
    long boxA;
    long boxB;

    @BeforeEach
    void setup() {
        // Never use a developer's configured AI endpoint or key in tests.
        ai = new AiService(repository, history, attachments, mapper, settingsDir) {
            @Override public Map<String, Object> getSettings(boolean includeKey) { return Map.of("api_key", ""); }
        };
        keyword = "ScopeProbe" + UUID.randomUUID().toString().replace("-", "");
        boxA = id(repository.createContainer(Map.of("name", keyword + "甲箱", "owner_id", 1)));
        boxB = id(repository.createContainer(Map.of("name", keyword + "乙箱", "owner_id", 2)));
        itemA = id(repository.createItem(Map.of("name", keyword + "甲耳机", "container_id", boxA)));
        repository.createItem(Map.of("name", keyword + "乙耳机", "container_id", boxB));
    }

    @Test void allMembersAreSearchedByDefault() {
        assertThat(ai.chat(keyword, List.of()).get("reply").toString()).contains("甲耳机", "乙耳机");
    }

    @Test void selectedMembersRestrictSearch() {
        assertThat(ai.chat(keyword, List.of(1L)).get("reply").toString()).contains("甲耳机").doesNotContain("乙耳机");
    }

    @Test void invalidScopeNeverBecomesAllMembers() {
        assertThatThrownBy(() -> ai.chat(keyword, List.of(Long.MAX_VALUE))).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> ai.executeAction(Map.of("type", "delete_item", "item_id", itemA), List.of(Long.MAX_VALUE)))
            .isInstanceOf(IllegalArgumentException.class);
        assertThat(repository.getItem(itemA)).isNotNull();
    }

    @Test void moveRespectsScopeAndAllMembersAllowsCrossMemberMoves() {
        Map<String, Object> move = Map.of("type", "move_item", "item_id", itemA, "container_id", boxB);
        assertThatThrownBy(() -> ai.executeAction(move, List.of(1L))).isInstanceOf(IllegalArgumentException.class);
        assertThat(((Number) repository.getItem(itemA).get("container_id")).longValue()).isEqualTo(boxA);
        ai.executeAction(move, List.of());
        assertThat(((Number) repository.getItem(itemA).get("container_id")).longValue()).isEqualTo(boxB);
    }

    @Test void oldExpiryDataIsNotShownAndExpiryActionsAreRejected() {
        lifecycle.upsert(itemA, Map.of("expiry_date", "2037-08-09", "lifecycle_type", "EXPIRY"));
        assertThat(ai.chat(keyword, List.of(1L)).get("reply").toString()).doesNotContain("2037-08-09", "有效期", "生命周期");
        assertThatThrownBy(() -> ai.executeAction(Map.of("type", "set_lifecycle", "item_id", itemA), List.of()))
            .isInstanceOf(IllegalArgumentException.class);
        assertThat(lifecycle.getByItem(itemA).get("expiry_date")).isEqualTo("2037-08-09");
    }

    @Test void listingBoxesRespectsSelectedMembers() {
        assertThat(ai.chat("我有哪些箱子？", List.of(1L)).get("reply").toString()).contains(keyword + "甲箱").doesNotContain(keyword + "乙箱");
    }

    private static long id(Map<String, Object> value) { return ((Number) value.get("id")).longValue(); }
}
