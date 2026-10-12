# A looser parallel test with a predicate
tilted = Box(10, 10, 10).rotate(X, 0.5)
print(len(tilted.edges().parallel_to(Z)))                                              # 0
print(len(tilted.edges().lines().filter(lambda e: e.direction.is_parallel(Z.direction, 1))))   # 4
