package com.xyblue.itemnest.repository;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Integration tests for {@link InventoryRepository}, exercising the real SQLite
 * database, FTS5 triggers and batch operations end-to-end.
 */
@SpringBootTest(properties = {
    "itemnest.data-dir=target/test-data-inventory",
    "itemnest.rabbitmq.enabled=false"
})
class InventoryRepositoryTests {

    @Autowired InventoryRepository repo;
    @Autowired JdbcTemplate jdbc;

    private long containerA;
    private long containerB;

    @BeforeEach
    void seedContainers() {
        // 清空上次测试残留数据，避免 containers.name 唯一约束冲突
        jdbc.update("DELETE FROM attachments");
        jdbc.update("DELETE FROM items");
        jdbc.update("DELETE FROM items_fts");
        jdbc.update("DELETE FROM containers");
        // 每个测试用例都先准备两个干净箱子
        containerA = ((Number) repo.createContainer(Map.of(
            "name", "厨房 A", "notes", "主厨房", "owner_id", 1
        )).get("id")).longValue();
        containerB = ((Number) repo.createContainer(Map.of(
            "name", "书房 B", "notes", "二楼", "owner_id", 1
        )).get("id")).longValue();
    }

    @Test
    @DisplayName("listContainers 包含 item_count 与 quantity_sum 聚合")
    void listContainersAggregatesItemCount() {
        repo.createItem(Map.of("container_id", containerA, "name", "苹果", "quantity", 3));
        repo.createItem(Map.of("container_id", containerA, "name", "香蕉", "quantity", 5));
        repo.createItem(Map.of("container_id", containerB, "name", "订书机"));

        List<Map<String, Object>> rows = repo.listContainers();
        Map<String, Object> a = rows.stream().filter(r -> ((Number) r.get("id")).longValue() == containerA).findFirst().orElseThrow();
        Map<String, Object> b = rows.stream().filter(r -> ((Number) r.get("id")).longValue() == containerB).findFirst().orElseThrow();

        assertThat(((Number) a.get("item_count")).intValue()).isEqualTo(2);
        assertThat(((Number) a.get("quantity_sum")).intValue()).isEqualTo(8);
        assertThat(((Number) b.get("item_count")).intValue()).isEqualTo(1);
        // quantity 缺失时按 1 计入
        assertThat(((Number) b.get("quantity_sum")).intValue()).isEqualTo(1);
    }

    @Test
    @DisplayName("listItems 走 LIKE 兜底分支：当 query 不命中 FTS5 时仍能搜出")
    void listItemsFallsBackToLikeWhenFtsMisses() {
        repo.createItem(Map.of("container_id", containerA, "name", "Nikon 单反", "notes", "含 50mm 套头", "tags", "摄影"));
        // 这个词足够奇怪（符号/单字）不会进入 FTS，但 LIKE 仍能命中
        List<Map<String, Object>> rows = repo.listItems("单反", null);
        assertThat(rows).extracting(r -> String.valueOf(r.get("name"))).contains("Nikon 单反");
    }

    @Test
    @DisplayName("searchItems 命中 FTS5，并按 bm25 排序")
    void searchItemsUsesFts() {
        repo.createItem(Map.of("container_id", containerA, "name", "锂电池", "tags", "3.7V 充电"));
        repo.createItem(Map.of("container_id", containerA, "name", "锂电池组", "tags", "12V"));
        repo.createItem(Map.of("container_id", containerB, "name", "订书机", "tags", "办公"));

        List<Map<String, Object>> rows = repo.searchItems("锂电池", null, List.of(), 20);
        // unicode61 把整段中文当一个 token，只能前缀匹配；搜"锂电池"命中"锂电池"与"锂电池组"
        assertThat(rows).extracting(r -> String.valueOf(r.get("name")))
            .containsAnyOf("锂电池", "锂电池组");
    }

    @Test
    @DisplayName("deleteItem 同步删除 FTS 记录，再次搜不到")
    void deleteItemRemovesFtsEntry() {
        long id = ((Number) repo.createItem(Map.of("container_id", containerA, "name", "一次性拖鞋")).get("id")).longValue();
        assertThat(repo.searchItems("一次性拖鞋", null, List.of(), 20)).isNotEmpty();
        assertThat(repo.deleteItem(id)).isTrue();
        assertThat(repo.getItem(id)).isNull();
        assertThat(repo.searchItems("一次性拖鞋", null, List.of(), 20)).isEmpty();
    }

    @Test
    @DisplayName("deleteContainer 在仍有物品时拒绝并抛出异常")
    void deleteContainerBlocksWhenItemsExist() {
        repo.createItem(Map.of("container_id", containerA, "name", "占位物品"));
        assertThatThrownBy(() -> repo.deleteContainer(containerA))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("还有物品");
        // 容器仍存在
        assertThat(repo.getContainer(containerA)).isNotNull();
    }

    @Test
    @DisplayName("summary 与 memberSummary 数据自洽")
    void summaryAndMemberSummary() {
        repo.createItem(Map.of("container_id", containerA, "name", "X", "quantity", 2, "condition", "正常"));
        repo.createItem(Map.of("container_id", containerA, "name", "Y", "quantity", 1, "condition", "损坏"));
        Map<String, Object> summary = repo.summary();
        assertThat(((Number) summary.get("containers")).intValue()).isEqualTo(2);
        assertThat(((Number) summary.get("items")).intValue()).isEqualTo(2);
        assertThat(((Number) summary.get("quantity")).intValue()).isEqualTo(3);
        // 损坏的算 special
        assertThat(((Number) summary.get("special")).intValue()).isEqualTo(1);
    }

    @Test
    @DisplayName("listItems 接受 ownerIds 过滤")
    void listItemsAppliesOwnerFilter() {
        // owner 2 还没有箱子，先建一个
        Map<String, Object> otherMemberContainer = repo.createContainer(Map.of(
            "name", "我爸的箱子", "owner_id", 2
        ));
        long otherContainerId = ((Number) otherMemberContainer.get("id")).longValue();
        repo.createItem(Map.of("container_id", otherContainerId, "name", "老爸的茶"));
        long mineId = ((Number) repo.createItem(Map.of("container_id", containerA, "name", "我的茶")).get("id")).longValue();
        repo.updateItem(mineId, Map.of("condition", "正常"));
        List<Map<String, Object>> onlyOwner1 = repo.listItems("茶", null, List.of(1L), 20);
        assertThat(onlyOwner1).allSatisfy(row ->
            assertThat(((Number) row.get("owner_id")).longValue()).isEqualTo(1L)
        );
        List<Map<String, Object>> onlyOwner2 = repo.listItems("茶", null, List.of(2L), 20);
        assertThat(onlyOwner2).allSatisfy(row ->
            assertThat(((Number) row.get("owner_id")).longValue()).isEqualTo(2L)
        );
    }
}
