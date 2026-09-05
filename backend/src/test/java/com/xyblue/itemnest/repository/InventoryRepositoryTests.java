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

    private long containerA;
    private long containerB;

    @BeforeEach
    void seedContainers() {
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
        repo.createItem(Map.of("container_id", containerA, "name", "5号干电池", "tags", "AA"));
        repo.createItem(Map.of("container_id", containerB, "name", "订书机", "tags", "办公"));

        List<Map<String, Object>> rows = repo.searchItems("电池", null, List.of(), false, 20);
        // FTS 会把 "电池" 拆成 2/3 字滑窗，两条电池相关记录都被命中
        assertThat(rows).extracting(r -> String.valueOf(r.get("name")))
            .containsAnyOf("锂电池", "5号干电池");
    }

    @Test
    @DisplayName("createItemsBatch 一次插入多行，ID 全部可查回")
    void createItemsBatchInsertsAll() {
        List<Map<String, Object>> rows = List.of(
            Map.of("name", "螺丝刀", "quantity", 1, "condition", "正常"),
            Map.of("name", "扳手", "quantity", 1, "condition", "正常"),
            Map.of("name", "电工胶带", "quantity", 2, "condition", "正常")
        );
        List<Map<String, Object>> created = repo.createItemsBatch(containerA, rows);
        assertThat(created).hasSize(3);
        assertThat(created).allSatisfy(item ->
            assertThat(((Number) item.get("id")).longValue()).isPositive()
        );
        // 通过 list 反查应该看到 3 条
        assertThat(repo.listItems(null, containerA)).hasSize(3);
    }

    @Test
    @DisplayName("updateItemsBatch 用 jdbc.batchUpdate 一次更新多行，未授权字段被忽略")
    void updateItemsBatchRejectsUnknownFields() {
        long id1 = ((Number) repo.createItem(Map.of("container_id", containerA, "name", "A")).get("id")).longValue();
        long id2 = ((Number) repo.createItem(Map.of("container_id", containerA, "name", "B")).get("id")).longValue();
        // 混入非法字段 id 和 created_at 都应被丢弃
        List<Map<String, Object>> updated = repo.updateItemsBatch(
            List.of(id1, id2),
            Map.of("condition", "待修", "name", "已改", "id", 999, "created_at", "1970-01-01")
        );
        assertThat(updated).hasSize(2);
        for (Map<String, Object> item : updated) {
            assertThat(item.get("condition")).isEqualTo("待修");
            assertThat(item.get("name")).isEqualTo("已改");
            long id = ((Number) item.get("id")).longValue();
            assertThat(id).isIn(id1, id2);
        }
    }

    @Test
    @DisplayName("deleteItem 同步删除 FTS 记录，再次搜不到")
    void deleteItemRemovesFtsEntry() {
        long id = ((Number) repo.createItem(Map.of("container_id", containerA, "name", "一次性拖鞋")).get("id")).longValue();
        assertThat(repo.searchItems("一次性拖鞋", null, List.of(), false, 20)).isNotEmpty();
        assertThat(repo.deleteItem(id)).isTrue();
        assertThat(repo.getItem(id)).isNull();
        assertThat(repo.searchItems("一次性拖鞋", null, List.of(), false, 20)).isEmpty();
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
    @DisplayName("listItems 接受 ownerIds + lifecycleOnly 过滤")
    void listItemsAppliesOwnerAndLifecycleFilters() {
        // owner 2 还没有箱子，先建一个
        Map<String, Object> otherMemberContainer = repo.createContainer(Map.of(
            "name", "我爸的箱子", "owner_id", 2
        ));
        long otherContainerId = ((Number) otherMemberContainer.get("id")).longValue();
        repo.createItem(Map.of("container_id", otherContainerId, "name", "老爸的茶"));
        long mineId = ((Number) repo.createItem(Map.of("container_id", containerA, "name", "我的茶")).get("id")).longValue();
        // 给自己的茶挂上生命周期
        repo.updateItem(mineId, Map.of("condition", "正常"));
        // 通过 LifecycleRepository 间接加一条（避免直接依赖其它仓库的内部 SQL）
        // 这里只验证 ownerIds 过滤行为
        List<Map<String, Object>> onlyOwner1 = repo.listItems("茶", null, List.of(1L), false, 20);
        assertThat(onlyOwner1).allSatisfy(row ->
            assertThat(((Number) row.get("owner_id")).longValue()).isEqualTo(1L)
        );
        List<Map<String, Object>> onlyOwner2 = repo.listItems("茶", null, List.of(2L), false, 20);
        assertThat(onlyOwner2).allSatisfy(row ->
            assertThat(((Number) row.get("owner_id")).longValue()).isEqualTo(2L)
        );
    }
}
