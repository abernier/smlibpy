block = Box(20, 20, 20)
print(block.offset(2).bbox().size.to_tuple(), round(block.offset(2).volume, 1))   # (24.0, 24.0, 24.0) 13824.0: sharp edges
print(round(block.offset(-2).volume, 1))                # 4096.0 = 16^3
plate = Box(40, 40, 10) - Cylinder(5, 20)
thin = plate.offset(-2)                                 # 36 x 36 x 6, the hole grows to r 7
print(round(thin.volume, 1))                            # 6852.4 = (36^2 - pi*7^2) * 6
