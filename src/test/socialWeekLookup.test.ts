import {beforeEach,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({from:vi.fn(),select:vi.fn(),eq:vi.fn(),or:vi.fn(),gte:vi.fn(),lte:vi.fn(),order:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:mock.from}}));
import {getSocialWeekPuzzles} from '@/lib/puzzles';
beforeEach(()=>{vi.clearAllMocks();for(const fn of [mock.from,mock.select,mock.eq,mock.or,mock.gte,mock.lte])fn.mockReturnValue(mock);});
it('looks up only published full daily metadata inside the exact date range',async()=>{
 mock.order.mockResolvedValue({data:[{id:'p',date:'2026-11-02'}],error:null});
 expect(await getSocialWeekPuzzles('2026-11-02','2026-11-05')).toEqual([{id:'p',date:'2026-11-02'}]);
 expect(mock.from).toHaveBeenCalledWith('puzzles');expect(mock.select).toHaveBeenCalledWith('id,date');
 expect(mock.eq.mock.calls).toEqual([['is_published',true],['is_beta',false],['format','full']]);
 expect(mock.or).toHaveBeenCalledWith('is_free_puzzle.is.null,is_free_puzzle.eq.false');
 expect(mock.gte).toHaveBeenCalledWith('date','2026-11-02');expect(mock.lte).toHaveBeenCalledWith('date','2026-11-05');
});
it('distinguishes a missing published day from a failed lookup',async()=>{
 mock.order.mockResolvedValueOnce({data:[],error:null}).mockResolvedValueOnce({data:null,error:{message:'offline'}});
 expect(await getSocialWeekPuzzles('2026-11-02','2026-11-05')).toEqual([]);
 await expect(getSocialWeekPuzzles('2026-11-02','2026-11-05')).rejects.toThrow('unavailable');
});
